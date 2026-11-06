//! Reading the run's whole tool catalog, page by page.
use std::{collections::HashSet, future::Future};

use super::runtime_errors::RuntimeError;

/// One page of a catalog.
pub(crate) struct ToolPage<T> {
    pub(crate) tools: Vec<T>,
    pub(crate) next_cursor: Option<String>,
}

/// Bounded pagination must fail explicitly, never silently truncate a catalog.
pub(crate) async fn collect_tool_pages<T, L, F, N>(mut list: L, name_of: N) -> Result<Vec<T>, RuntimeError>
where
    L: FnMut(Option<String>) -> F,
    F: Future<Output = Result<ToolPage<T>, RuntimeError>>,
    N: Fn(&T) -> &str,
{
    let mut items = Vec::new();
    let mut names = HashSet::new();
    let mut cursors = HashSet::new();
    let mut cursor = None;
    for _ in 0..100 {
        let result = list(cursor.clone()).await?;
        for item in result.tools {
            if !names.insert(name_of(&item).to_owned()) {
                return Err(RuntimeError::error("duplicate_tool: ambiguous capability catalog"));
            }
            items.push(item);
            if items.len() > 1000 {
                return Err(RuntimeError::error("tool_catalog_limit: narrow the run's capability scope"));
            }
        }
        let Some(next) = result.next_cursor.filter(|next| !next.is_empty()) else {
            return Ok(items);
        };
        if !cursors.insert(next.clone()) {
            return Err(RuntimeError::error("invalid_tool_cursor: repeated catalog page"));
        }
        cursor = Some(next);
    }
    Err(RuntimeError::error("tool_catalog_limit: too many catalog pages"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn name_of(name: &String) -> &str {
        name
    }

    #[tokio::test]
    async fn discovers_capabilities_beyond_the_first_hundred() {
        let items = collect_tool_pages(
            |cursor| async move {
                Ok(match cursor {
                    Some(_) => ToolPage { tools: vec!["habits.record".to_owned()], next_cursor: None },
                    None => ToolPage { tools: (0..100).map(|n| format!("tools.{n}")).collect(), next_cursor: Some("next".to_owned()) },
                })
            },
            name_of,
        )
        .await
        .unwrap();
        assert_eq!(items.last().map(String::as_str), Some("habits.record"));
        assert_eq!(items.len(), 101);
    }

    #[tokio::test]
    async fn rejects_cyclic_cursors_and_duplicate_names() {
        let cyclic = collect_tool_pages(|_| async { Ok(ToolPage::<String> { tools: Vec::new(), next_cursor: Some("loop".to_owned()) }) }, name_of).await;
        assert!(cyclic.unwrap_err().to_string().contains("invalid_tool_cursor"));
        let duplicate = collect_tool_pages(|_| async { Ok(ToolPage { tools: vec!["x".to_owned(), "x".to_owned()], next_cursor: None }) }, name_of).await;
        assert!(duplicate.unwrap_err().to_string().contains("duplicate_tool"));
    }

    #[tokio::test]
    async fn fails_rather_than_truncating_a_catalog() {
        let mut page = 0;
        let too_many = collect_tool_pages(
            |_| {
                page += 1;
                let tools: Vec<String> = (0..11).map(|n| format!("t{page}.{n}")).collect();
                async move { Ok(ToolPage { tools, next_cursor: Some(format!("c{page}")) }) }
            },
            name_of,
        )
        .await;
        assert!(too_many.unwrap_err().to_string().contains("narrow the run's capability scope"));
        let mut page = 0;
        let endless = collect_tool_pages(
            |_| {
                page += 1;
                let next_cursor = Some(format!("c{page}"));
                async move { Ok(ToolPage::<String> { tools: Vec::new(), next_cursor }) }
            },
            name_of,
        )
        .await;
        assert!(endless.unwrap_err().to_string().contains("too many catalog pages"));
    }
}
