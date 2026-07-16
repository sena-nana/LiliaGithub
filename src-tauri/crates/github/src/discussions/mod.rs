use std::fmt;

use lilia_github_contracts::workspace::GitHubRepositoryDiscussionMetadata;
use serde_json::{json, Value};

mod mapping;
mod queries;
mod validation;
mod wire;

pub use mapping::{
    parse_comments_response, parse_create_response, parse_detail_response, parse_list_response,
    parse_metadata_response, parse_replies_response,
};
pub use queries::{
    comments_request, create_request, detail_request, list_request, metadata_request,
    replies_request,
};

#[derive(Debug, Clone, PartialEq)]
pub struct GitHubGraphQlRequest {
    pub query: &'static str,
    pub variables: Value,
}

impl GitHubGraphQlRequest {
    pub fn payload(&self) -> Value {
        json!({ "query": self.query, "variables": self.variables })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitHubDiscussionApiError {
    pub code: &'static str,
    pub message: String,
}

impl GitHubDiscussionApiError {
    pub(super) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn contextualize(&self, prefix: &str) -> String {
        format!("{}：{}：{}", self.code, prefix, self.message)
    }
}

impl fmt::Display for GitHubDiscussionApiError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}：{}", self.code, self.message)
    }
}

impl std::error::Error for GitHubDiscussionApiError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitHubRepositoryDiscussionContext {
    pub repository_id: String,
    pub metadata: GitHubRepositoryDiscussionMetadata,
}

#[cfg(test)]
mod tests;
