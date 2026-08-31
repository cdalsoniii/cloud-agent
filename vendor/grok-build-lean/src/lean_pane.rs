//! Reference Lean pane module for grok-build fork (Path C).
//! Integrate into `crates/xai_grok_pager/src/` and wire layout split when
//! `config.ui.lean_pane_enabled` is true.

use serde::Deserialize;
use std::time::Duration;

#[derive(Debug, Clone, Deserialize, Default)]
pub struct LeanLiveState {
    pub status: Option<String>,
    pub workspace: Option<String>,
    #[serde(rename = "updatedAt")]
    pub updated_at: Option<String>,
    pub goals: Option<Vec<String>>,
    pub diagnostics: Option<Vec<LeanDiagnostic>>,
    #[serde(rename = "lastOutputTail")]
    pub last_output_tail: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LeanDiagnostic {
    pub file: String,
    pub line: u32,
    pub severity: String,
    pub message: String,
}

pub struct LeanPaneConfig {
    pub enabled: bool,
    pub url: String,
    pub width_percent: u8,
}

impl Default for LeanPaneConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            url: "http://127.0.0.1:9474".to_string(),
            width_percent: 35,
        }
    }
}

pub fn fetch_state(url: &str) -> Result<LeanLiveState, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;
    let state: LeanLiveState = client
        .get(format!("{url}/state"))
        .send()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())?;
    Ok(state)
}

/// Render lean pane lines for the right column (ratatui-friendly).
pub fn render_lines(state: &LeanLiveState) -> Vec<String> {
    let mut lines = vec![
        "Lean Live".to_string(),
        format!("status: {}", state.status.as_deref().unwrap_or("?")),
        format!("workspace: {}", state.workspace.as_deref().unwrap_or("?")),
        format!("updated: {}", state.updated_at.as_deref().unwrap_or("?")),
        String::new(),
    ];
    if let Some(goals) = &state.goals {
        if !goals.is_empty() {
            lines.push("Goals:".to_string());
            for g in goals.iter().take(12) {
                lines.push(format!("  {g}"));
            }
            lines.push(String::new());
        }
    }
    if let Some(diags) = &state.diagnostics {
        if !diags.is_empty() {
            lines.push("Diagnostics:".to_string());
            for d in diags.iter().take(16) {
                lines.push(format!(
                    "  [{}] {}:{} {}",
                    d.severity, d.file, d.line, d.message
                ));
            }
        }
    }
    if let Some(tail) = &state.last_output_tail {
        lines.push(String::new());
        lines.push("Build tail:".to_string());
        for ln in tail.lines().rev().take(8).collect::<Vec<_>>().into_iter().rev() {
            lines.push(format!("  {ln}"));
        }
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_includes_status() {
        let state = LeanLiveState {
            status: Some("ok".into()),
            workspace: Some("/tmp/lean".into()),
            updated_at: None,
            goals: None,
            diagnostics: None,
            last_output_tail: None,
        };
        let lines = render_lines(&state);
        assert!(lines.iter().any(|l| l.contains("ok")));
    }
}
