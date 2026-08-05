use std::env;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use lilia_github_workspace::workspace::github::github_release_asset_stream_body;
use reqwest::blocking::{Body, Client};
use serde::{Deserialize, Serialize};

const ASSET_BYTES: u64 = 512 * 1024 * 1024;
const MAX_STREAMING_RSS_BYTES: u64 = 32 * 1024 * 1024;
const MIN_STREAMING_THROUGHPUT_RATIO: f64 = 0.90;
const DEFAULT_SAMPLES: usize = 3;
const MAX_HEADER_BYTES: usize = 64 * 1024;
// This is intentionally far above a practical GitHub upload. It keeps the default A/B focused on
// transfer throughput instead of reqwest blocking Body's fixed 8 KiB frame scheduling ceiling.
// Set LILIA_RELEASE_ASSET_BENCH_UNTHROTTLED=1 to expose that local diagnostic separately.
const LOOPBACK_BYTES_PER_SECOND: u64 = 512 * 1024 * 1024;
const PACING_QUANTUM_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum TransferMode {
    Buffered,
    Streaming,
}

impl TransferMode {
    fn as_arg(self) -> &'static str {
        match self {
            Self::Buffered => "buffered",
            Self::Streaming => "streaming",
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Measurement {
    mode: TransferMode,
    bytes: u64,
    elapsed_nanos: u128,
    peak_rss_delta_bytes: u64,
}

impl Measurement {
    fn throughput_mib_per_second(&self) -> f64 {
        let seconds = Duration::from_nanos(self.elapsed_nanos as u64).as_secs_f64();
        self.bytes as f64 / (1024.0 * 1024.0) / seconds
    }
}

struct SparseAsset {
    directory: PathBuf,
    path: PathBuf,
}

impl SparseAsset {
    fn create() -> io::Result<Self> {
        let root = env::temp_dir();
        for sequence in 0..16_u32 {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let directory = root.join(format!(
                "lilia-release-stream-bench-{}-{nonce}-{sequence}",
                std::process::id()
            ));
            match fs::create_dir(&directory) {
                Ok(()) => {
                    let path = directory.join("release-asset.bin");
                    let file = File::create(&path)?;
                    file.set_len(ASSET_BYTES)?;
                    return Ok(Self { directory, path });
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error),
            }
        }
        Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "could not allocate a unique benchmark directory",
        ))
    }
}

impl Drop for SparseAsset {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
        let _ = fs::remove_dir(&self.directory);
    }
}

fn main() {
    if let Err(error) = run() {
        eprintln!("release asset benchmark failed: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let arguments = env::args().collect::<Vec<_>>();
    if arguments.get(1).map(String::as_str) == Some("--child") {
        return run_child(&arguments);
    }

    let sample_count = env::var("LILIA_RELEASE_ASSET_BENCH_SAMPLES")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_SAMPLES);
    let asset = SparseAsset::create()?;
    let mut buffered = Vec::with_capacity(sample_count);
    let mut streaming = Vec::with_capacity(sample_count);

    for sample_index in 0..sample_count {
        let order = if sample_index.is_multiple_of(2) {
            [TransferMode::Buffered, TransferMode::Streaming]
        } else {
            [TransferMode::Streaming, TransferMode::Buffered]
        };
        for mode in order {
            let measurement = run_measurement_process(mode, &asset.path)?;
            match mode {
                TransferMode::Buffered => buffered.push(measurement),
                TransferMode::Streaming => streaming.push(measurement),
            }
        }
    }

    let baseline_throughput = median_throughput(&buffered);
    let streaming_throughput = median_throughput(&streaming);
    let throughput_ratio = streaming_throughput / baseline_throughput;
    let streaming_peak_rss = streaming
        .iter()
        .map(|measurement| measurement.peak_rss_delta_bytes)
        .max()
        .unwrap_or_default();
    let buffered_peak_rss = buffered
        .iter()
        .map(|measurement| measurement.peak_rss_delta_bytes)
        .max()
        .unwrap_or_default();
    let rss_passed = streaming_peak_rss <= MAX_STREAMING_RSS_BYTES;
    let throughput_passed = throughput_ratio >= MIN_STREAMING_THROUGHPUT_RATIO;

    println!("Release asset transfer benchmark: {sample_count} fresh-process samples per mode");
    let sink = if env::var_os("LILIA_RELEASE_ASSET_BENCH_UNTHROTTLED").is_some() {
        "unthrottled loopback sink".to_string()
    } else {
        format!(
            "deterministic loopback sink: {:.0} MiB/s",
            LOOPBACK_BYTES_PER_SECOND as f64 / 1024.0 / 1024.0
        )
    };
    println!(
        "asset: {:.0} MiB sparse file, {sink}",
        ASSET_BYTES as f64 / 1024.0 / 1024.0
    );
    println!(
        "buffered baseline: {:.1} MiB/s, peak RSS delta {:.1} MiB",
        baseline_throughput,
        buffered_peak_rss as f64 / 1024.0 / 1024.0
    );
    println!(
        "production streaming: {:.1} MiB/s, peak RSS delta {:.1} MiB",
        streaming_throughput,
        streaming_peak_rss as f64 / 1024.0 / 1024.0
    );
    println!(
        "RSS <= 32 MiB: {}",
        if rss_passed { "PASS" } else { "FAIL" }
    );
    println!(
        "throughput >= baseline 90%: {} ({:.1}%)",
        if throughput_passed { "PASS" } else { "FAIL" },
        throughput_ratio * 100.0
    );

    if !rss_passed || !throughput_passed {
        return Err("one or more performance thresholds were not met".into());
    }
    Ok(())
}

fn run_child(arguments: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let mode = match arguments.get(2).map(String::as_str) {
        Some("buffered") => TransferMode::Buffered,
        Some("streaming") => TransferMode::Streaming,
        _ => return Err("child transfer mode must be buffered or streaming".into()),
    };
    let path = arguments
        .get(3)
        .map(PathBuf::from)
        .ok_or("child asset path is missing")?;
    let measurement = measure_transfer(mode, &path)?;
    println!("{}", serde_json::to_string(&measurement)?);
    Ok(())
}

fn run_measurement_process(
    mode: TransferMode,
    path: &Path,
) -> Result<Measurement, Box<dyn std::error::Error>> {
    let output = Command::new(env::current_exe()?)
        .arg("--child")
        .arg(mode.as_arg())
        .arg(path)
        .stdin(Stdio::null())
        .stderr(Stdio::inherit())
        .output()?;
    if !output.status.success() {
        return Err(format!("{} child exited with {}", mode.as_arg(), output.status).into());
    }
    Ok(serde_json::from_slice(&output.stdout)?)
}

fn measure_transfer(
    mode: TransferMode,
    path: &Path,
) -> Result<Measurement, Box<dyn std::error::Error>> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let address = listener.local_addr()?;
    let client = Client::builder().no_proxy().build()?;
    let initial_peak_rss = peak_rss_bytes()?;
    let started = Instant::now();
    let (body, size) = match mode {
        TransferMode::Buffered => buffered_body(path)?,
        TransferMode::Streaming => github_release_asset_stream_body(path)?,
    };
    if size != ASSET_BYTES {
        return Err(format!("asset size changed: expected {ASSET_BYTES}, got {size}").into());
    }
    let receiver = thread::spawn(move || receive_request(listener));
    let response = client
        .post(format!("http://{address}/release-asset"))
        .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
        .body(body)
        .send()?
        .error_for_status()?;
    drop(response);
    let received = receiver
        .join()
        .map_err(|_| "loopback receiver thread panicked")??;
    if received != size {
        return Err(format!("receiver consumed {received} bytes instead of {size}").into());
    }
    let elapsed = started.elapsed();
    let final_peak_rss = peak_rss_bytes()?;
    Ok(Measurement {
        mode,
        bytes: size,
        elapsed_nanos: elapsed.as_nanos(),
        peak_rss_delta_bytes: final_peak_rss.saturating_sub(initial_peak_rss),
    })
}

fn buffered_body(path: &Path) -> Result<(Body, u64), Box<dyn std::error::Error>> {
    let bytes = fs::read(path)?;
    let size = bytes.len() as u64;
    Ok((Body::from(bytes), size))
}

fn receive_request(listener: TcpListener) -> io::Result<u64> {
    let (mut stream, _) = listener.accept()?;
    stream.set_read_timeout(Some(Duration::from_secs(60)))?;
    let (content_length, buffered_body_bytes) = read_request_headers(&mut stream)?;
    let mut received = buffered_body_bytes as u64;
    let mut buffer = [0_u8; 64 * 1024];
    let started = Instant::now();
    let mut next_pacing_boundary = PACING_QUANTUM_BYTES;
    let paced = env::var_os("LILIA_RELEASE_ASSET_BENCH_UNTHROTTLED").is_none();
    while received < content_length {
        let remaining = (content_length - received).min(buffer.len() as u64) as usize;
        let count = stream.read(&mut buffer[..remaining])?;
        if count == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "request body ended before Content-Length",
            ));
        }
        received += count as u64;
        if paced && (received >= next_pacing_boundary || received == content_length) {
            pace_loopback_receiver(started, received);
            next_pacing_boundary = received.saturating_add(PACING_QUANTUM_BYTES);
        }
    }
    stream
        .write_all(b"HTTP/1.1 201 Created\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")?;
    Ok(received)
}

fn pace_loopback_receiver(started: Instant, received: u64) {
    let target = Duration::from_secs_f64(received as f64 / LOOPBACK_BYTES_PER_SECOND as f64);
    if let Some(remaining) = target.checked_sub(started.elapsed()) {
        thread::sleep(remaining);
    }
}

fn read_request_headers(stream: &mut TcpStream) -> io::Result<(u64, usize)> {
    let mut bytes = Vec::with_capacity(4096);
    let mut buffer = [0_u8; 4096];
    loop {
        let count = stream.read(&mut buffer)?;
        if count == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "request ended before headers",
            ));
        }
        bytes.extend_from_slice(&buffer[..count]);
        if let Some(header_end) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
            let body_start = header_end + 4;
            let headers = std::str::from_utf8(&bytes[..header_end]).map_err(|error| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("invalid headers: {error}"),
                )
            })?;
            let content_length = headers
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<u64>().ok())
                        .flatten()
                })
                .ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidData, "missing Content-Length")
                })?;
            return Ok((content_length, bytes.len() - body_start));
        }
        if bytes.len() > MAX_HEADER_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "request headers exceeded benchmark limit",
            ));
        }
    }
}

fn median_throughput(measurements: &[Measurement]) -> f64 {
    let mut values = measurements
        .iter()
        .map(Measurement::throughput_mib_per_second)
        .collect::<Vec<_>>();
    values.sort_by(f64::total_cmp);
    values[values.len() / 2]
}

#[cfg(unix)]
fn peak_rss_bytes() -> io::Result<u64> {
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::zeroed();
    if unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) } != 0 {
        return Err(io::Error::last_os_error());
    }
    let peak = unsafe { usage.assume_init() }.ru_maxrss as u64;
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    return Ok(peak);
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    Ok(peak.saturating_mul(1024))
}

#[cfg(not(unix))]
fn peak_rss_bytes() -> io::Result<u64> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "peak RSS measurement is currently supported on Unix targets",
    ))
}
