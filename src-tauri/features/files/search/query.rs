// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! Finding names: tantivy gathers candidates by each word of the query, exactly or within two
//! typos, and each is then scored against the whole name, so an exact name beats a prefix, a
//! prefix beats a part, and "invioce" still finds "invoice".
use std::path::Path;

use tantivy::{
    collector::TopDocs,
    query::{BooleanQuery, FuzzyTermQuery, Occur, Query, TermQuery},
    schema::IndexRecordOption,
    IndexReader, TantivyDocument, Term,
};

use super::catalog::{doc_from, Doc, Fields};

const CANDIDATES: usize = 10_000;

pub(super) fn split_tokens(value: &str) -> Vec<String> {
    value
        .split(|character: char| {
            character.is_whitespace() || matches!(character, '.' | '_' | '-' | '/')
        })
        .filter(|segment| !segment.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

pub(super) fn normalize_case(value: &str) -> String {
    value.trim().to_lowercase()
}

fn build_query(fields: &Fields, query: &str) -> Option<Box<dyn Query>> {
    let tokens = split_tokens(query);
    if tokens.is_empty() {
        return None;
    }
    let mut queries: Vec<(Occur, Box<dyn Query>)> = Vec::new();
    for token in tokens {
        let term = Term::from_field_text(fields.name, &token);
        queries.push((
            Occur::Should,
            Box::new(FuzzyTermQuery::new(term.clone(), 2, true)),
        ));
        queries.push((
            Occur::Should,
            Box::new(TermQuery::new(term, IndexRecordOption::Basic)),
        ));
    }
    Some(Box::new(BooleanQuery::from(queries)))
}

fn candidates(reader: &IndexReader, fields: &Fields, query: &str) -> Result<Vec<Doc>, String> {
    let Some(built) = build_query(fields, query) else {
        return Ok(Vec::new());
    };
    let searcher = reader.searcher();
    let hits = searcher
        .search(&built, &TopDocs::with_limit(CANDIDATES).order_by_score())
        .map_err(|error| format!("Search failed: {error}"))?;
    Ok(hits
        .into_iter()
        .filter_map(|(_, address)| searcher.doc::<TantivyDocument>(address).ok())
        .filter_map(|doc| doc_from(fields, &doc))
        .collect())
}

pub(super) fn matches(
    reader: &IndexReader,
    fields: &Fields,
    query: &str,
    scope: Option<&Path>,
) -> Result<Vec<Doc>, String> {
    let query = normalize_case(query);
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let bar = min_score(query.chars().count());
    let mut scored: Vec<(f32, Doc)> = candidates(reader, fields, &query)?
        .into_iter()
        .filter(|doc| !doc.hidden)
        .filter(|doc| scope.is_none_or(|scope| Path::new(&doc.path).starts_with(scope)))
        .map(|doc| (score(&query, &doc), doc))
        .filter(|(score, _)| *score >= bar)
        .collect();
    scored.sort_by(|(left_score, left), (right_score, right)| {
        right_score
            .partial_cmp(left_score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(scored.into_iter().map(|(_, doc)| doc).collect())
}

fn score(query: &str, doc: &Doc) -> f32 {
    let name = normalize_case(&doc.name);
    let mut score = if name == query {
        1.0
    } else if name.starts_with(query) {
        0.92
    } else if name.contains(query) {
        0.82
    } else {
        token_score(query, &name)
    };
    if doc.is_dir {
        score += 0.02;
    }
    score.min(1.25)
}

fn token_score(query: &str, name: &str) -> f32 {
    let query_tokens = split_tokens(query);
    let name_tokens = split_tokens(name);
    if query_tokens.is_empty() || name_tokens.is_empty() {
        return 0.0;
    }
    let mut total = 0.0;
    let mut matched = 0usize;
    for query_token in &query_tokens {
        let mut best = 0.0f32;
        for name_token in &name_tokens {
            if name_token == query_token {
                best = best.max(1.0);
            } else if name_token.starts_with(query_token.as_str()) {
                best = best.max(0.86);
            } else if name_token.contains(query_token.as_str()) {
                best = best.max(0.74);
            } else {
                let distance = edit_distance(query_token, name_token);
                let longest = query_token.chars().count().max(name_token.chars().count());
                if distance <= 2 && longest > 0 {
                    best = best.max((1.0 - distance as f32 / longest as f32) * 0.7);
                }
            }
        }
        if best > 0.5 {
            matched += 1;
        }
        total += best;
    }
    let ratio = matched as f32 / query_tokens.len() as f32;
    if ratio < 0.5 {
        return 0.0;
    }
    0.5 + (total / query_tokens.len() as f32) * 0.35 + ratio * 0.15
}

fn min_score(query_len: usize) -> f32 {
    match query_len {
        0..=3 => 0.9,
        4..=6 => 0.6,
        7..=9 => 0.5,
        _ => 0.45,
    }
}

fn edit_distance(first: &str, second: &str) -> usize {
    let a: Vec<char> = first.chars().collect();
    let b: Vec<char> = second.chars().collect();
    let mut before_previous = vec![0; b.len() + 1];
    let mut previous: Vec<usize> = (0..=b.len()).collect();
    let mut current = vec![0; b.len() + 1];
    for (i, a_char) in a.iter().enumerate() {
        current[0] = i + 1;
        for (j, b_char) in b.iter().enumerate() {
            let cost = usize::from(a_char != b_char);
            let mut best = (previous[j + 1] + 1)
                .min(current[j] + 1)
                .min(previous[j] + cost);
            if i > 0 && j > 0 && *a_char == b[j - 1] && a[i - 1] == *b_char {
                best = best.min(before_previous[j - 1] + 1);
            }
            current[j + 1] = best;
        }
        std::mem::swap(&mut before_previous, &mut previous);
        std::mem::swap(&mut previous, &mut current);
    }
    previous[b.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(name: &str) -> Doc {
        Doc {
            path: format!("/home/me/{name}"),
            name: name.to_owned(),
            extension: String::new(),
            is_file: true,
            is_dir: false,
            size: 1,
            modified_ms: 0,
            hidden: false,
        }
    }

    fn finds(query: &str, name: &str) -> bool {
        let query = normalize_case(query);
        score(&query, &doc(name)) >= min_score(query.chars().count())
    }

    #[test]
    fn a_swap_of_neighbours_is_one_typo() {
        assert_eq!(edit_distance("invioce", "invoice"), 1);
        assert_eq!(edit_distance("kitten", "sitting"), 3);
    }

    #[test]
    fn typos_still_find_the_file_and_strangers_do_not() {
        assert!(finds("invioce", "Invoice March.pdf"));
        assert!(finds("reprot", "report-2026.docx"));
        assert!(finds("Budget", "budget.xlsx"));
        assert!(!finds("holiday", "invoice.pdf"));
        assert!(!finds("ab", "xyz.txt"));
    }

    #[test]
    fn exact_names_beat_prefixes_and_prefixes_beat_parts() {
        let exact = score("notes", &doc("notes"));
        let prefix = score("notes", &doc("notes from monday"));
        let part = score("notes", &doc("my notes"));
        assert!(exact > prefix && prefix > part);
    }
}
