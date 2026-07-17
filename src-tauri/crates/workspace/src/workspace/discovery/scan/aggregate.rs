use std::collections::HashSet;
use std::future::Future;

use futures_util::stream::{self, StreamExt};
use lilia_github_contracts::discovery::{GitHubDiscoveryRepositoryFailure, GitHubDiscoverySection};

pub(super) const SOURCE_PAGE_SIZE: u32 = 100;
pub(super) const REPOSITORY_CONCURRENCY: usize = 4;

pub(super) struct RepositoryItems<T> {
    pub(super) items: Vec<T>,
    pub(super) truncated: bool,
}

struct SettledRepository<T> {
    index: usize,
    repo_full_name: String,
    result: Result<RepositoryItems<T>, String>,
}

pub(super) async fn aggregate_repositories<T, F, Fut>(
    repositories: Vec<String>,
    load: F,
) -> GitHubDiscoverySection<T>
where
    F: Fn(String) -> Fut + Clone,
    Fut: Future<Output = Result<RepositoryItems<T>, String>>,
{
    let requested_repository_count = repositories.len();
    let mut settled = stream::iter(repositories.into_iter().enumerate().map(
        |(index, repo_full_name)| {
            let load = load.clone();
            async move {
                let result = load(repo_full_name.clone()).await;
                SettledRepository {
                    index,
                    repo_full_name,
                    result,
                }
            }
        },
    ))
    .buffer_unordered(REPOSITORY_CONCURRENCY)
    .collect::<Vec<_>>()
    .await;
    settled.sort_by_key(|entry| entry.index);

    let mut items = Vec::new();
    let mut failures = Vec::new();
    let mut truncated = false;
    for entry in settled {
        match entry.result {
            Ok(value) => {
                items.extend(value.items);
                truncated |= value.truncated;
            }
            Err(message) => failures.push(GitHubDiscoveryRepositoryFailure {
                repo_full_name: entry.repo_full_name,
                message,
            }),
        }
    }
    GitHubDiscoverySection {
        items,
        successful_repository_count: requested_repository_count - failures.len(),
        failures,
        truncated,
        requested_repository_count,
    }
}

pub(super) fn normalize_repository_batch(repositories: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    repositories
        .into_iter()
        .filter_map(|repo_full_name| {
            let repo_full_name = repo_full_name.trim().to_string();
            let key = repo_full_name.to_ascii_lowercase();
            if repo_full_name.is_empty() || !seen.insert(key) {
                None
            } else {
                Some(repo_full_name)
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn aggregation_deduplicates_repositories_and_preserves_partial_results() {
        let repositories = normalize_repository_batch(vec![
            " Acme/One ".to_string(),
            "acme/one".to_string(),
            "Acme/Fail".to_string(),
            "Acme/Truncated".to_string(),
        ]);
        let result = aggregate_repositories(repositories, |repo_full_name| async move {
            if repo_full_name == "Acme/Fail" {
                return Err("forbidden".to_string());
            }
            Ok(RepositoryItems {
                truncated: repo_full_name == "Acme/Truncated",
                items: vec![repo_full_name],
            })
        })
        .await;

        assert_eq!(result.requested_repository_count, 3);
        assert_eq!(result.successful_repository_count, 2);
        assert_eq!(result.items, vec!["Acme/One", "Acme/Truncated"]);
        assert_eq!(
            result.failures,
            vec![GitHubDiscoveryRepositoryFailure {
                repo_full_name: "Acme/Fail".to_string(),
                message: "forbidden".to_string(),
            }]
        );
        assert!(result.truncated);
    }
}
