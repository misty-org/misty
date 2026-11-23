// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! Finding names in two passes. First every word of the query as the start of a word in the name
//! (an exact word counts more), which answers most searches at once; only when that finds fewer
//! than were asked for does a second pass look within two typos. Each candidate is read from the
//! index's fast fields alone (its path, whether it is a folder or hidden) and scored against the
//! whole name, so an exact name beats a prefix, a prefix beats a part, and "invioce" still finds
//! "invoice". A search that a newer one has replaced stops between steps.
use std::{collections::HashSet, path::Path};

use tantivy::{
    collector::TopDocs,
    columnar::{Column, StrColumn},
    query::{BooleanQuery, BoostQuery, FuzzyTermQuery, Occur, Query, TermQuery},
    schema::IndexRecordOption,
    IndexReader, Searcher, Term,
};

use super::catalog::{Fields, HIDDEN, IS_DIR, PATH};

const PREFIX_CANDIDATES: usize = 2_000;
const FUZZY_CANDIDATES: usize = 2_000;
const EXACT_BOOST: f32 = 2.0;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Hit {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub hidden: bool,
}

pub(super) struct Superseded;

pub(super) fn split_tokens(value: &str) -> Vec<String> {
    value
        .split(|character: char| {
            character.is_whitespace() || matches!(character, '.' | '_' | '-' | '/')
        })
        .filter(|segment| !segment.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn index_tokens(value: &str) -> Vec<String> {
    value
        .split(|character: char| !character.is_alphanumeric())
        .filter(|segment| !segment.is_empty() && segment.len() < 40)
        .map(str::to_lowercase)
        .collect()
}

pub(super) fn normalize_case(value: &str) -> String {
    value.trim().to_lowercase()
}

fn scope_clause(fields: &Fields, scope: Option<&Path>) -> Option<(Occur, Box<dyn Query>)> {
    let scope = scope?;
    let mut text = scope.to_string_lossy().into_owned();
    let separator = if cfg!(windows) { '\\' } else { '/' };
    if !text.ends_with(['/', '\\']) {
        text.push(separator);
    }
    let term = Term::from_field_text(fields.path, &text);
    Some((
        Occur::Must,
        Box::new(FuzzyTermQuery::new_prefix(term, 0, false)),
    ))
}

fn prefix_query(fields: &Fields, tokens: &[String], scope: Option<&Path>) -> Box<dyn Query> {
    let mut must: Vec<(Occur, Box<dyn Query>)> = tokens
        .iter()
        .map(|token| {
            let term = Term::from_field_text(fields.name, token);
            let exact: Box<dyn Query> = Box::new(BoostQuery::new(
                Box::new(TermQuery::new(term.clone(), IndexRecordOption::WithFreqs)),
                EXACT_BOOST,
            ));
            let prefix: Box<dyn Query> = Box::new(FuzzyTermQuery::new_prefix(term, 0, false));
            let either: Box<dyn Query> = Box::new(BooleanQuery::new(vec![
                (Occur::Should, exact),
                (Occur::Should, prefix),
            ]));
            (Occur::Must, either)
        })
        .collect();
    must.extend(scope_clause(fields, scope));
    Box::new(BooleanQuery::new(must))
}

fn fuzzy_query(fields: &Fields, tokens: &[String], scope: Option<&Path>) -> Box<dyn Query> {
    let words: Vec<(Occur, Box<dyn Query>)> = tokens
        .iter()
        .map(|token| {
            let term = Term::from_field_text(fields.name, token);
            let distance = if token.chars().count() <= 4 { 1 } else { 2 };
            let query: Box<dyn Query> = Box::new(FuzzyTermQuery::new(term, distance, true));
            (Occur::Should, query)
        })
        .collect();
    let words: Box<dyn Query> = Box::new(BooleanQuery::new(words));
    let mut all = vec![(Occur::Must, words)];
    all.extend(scope_clause(fields, scope));
    Box::new(BooleanQuery::new(all))
}

struct Columns {
    path: StrColumn,
    is_dir: Column<u64>,
    hidden: Column<u64>,
}

fn columns(searcher: &Searcher, segment: u32) -> Option<Columns> {
    let fast = searcher.segment_reader(segment).fast_fields();
    Some(Columns {
        path: fast.str(PATH).ok()??,
        is_dir: fast.u64(IS_DIR).ok()?,
        hidden: fast.u64(HIDDEN).ok()?,
    })
}

fn name_of(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

fn gather(searcher: &Searcher, query: &dyn Query, limit: usize) -> Result<Vec<Hit>, String> {
    let found = searcher
        .search(query, &TopDocs::with_limit(limit).order_by_score())
        .map_err(|error| format!("Search failed: {error}"))?;
    let mut segments: Vec<Option<Option<Columns>>> = (0..searcher.segment_readers().len())
        .map(|_| None)
        .collect();
    let mut hits = Vec::with_capacity(found.len());
    let mut text = String::new();
    for (_, address) in found {
        let slot = &mut segments[address.segment_ord as usize];
        let Some(columns) = slot
            .get_or_insert_with(|| columns(searcher, address.segment_ord))
            .as_ref()
        else {
            continue;
        };
        let Some(ord) = columns.path.term_ords(address.doc_id).next() else {
            continue;
        };
        text.clear();
        if !columns.path.ord_to_str(ord, &mut text).unwrap_or(false) {
            continue;
        }
        hits.push(Hit {
            name: name_of(&text).to_owned(),
            path: text.clone(),
            is_dir: columns.is_dir.first(address.doc_id) == Some(1),
            hidden: columns.hidden.first(address.doc_id) == Some(1),
        });
    }
    Ok(hits)
}

pub(super) fn matches(
    reader: &IndexReader,
    fields: &Fields,
    query: &str,
    scope: Option<&Path>,
    limit: usize,
    current: &dyn Fn() -> bool,
) -> Result<Result<Vec<Hit>, Superseded>, String> {
    let query = normalize_case(query);
    let tokens = index_tokens(&query);
    if query.is_empty() || tokens.is_empty() {
        return Ok(Ok(Vec::new()));
    }
    let bar = min_score(query.chars().count());
    let searcher = reader.searcher();
    let rank = |hits: Vec<Hit>, seen: &mut HashSet<String>, into: &mut Vec<(f32, Hit)>| {
        for hit in hits {
            if hit.hidden || !seen.insert(hit.path.clone()) {
                continue;
            }
            let score = score(&query, &hit.name, hit.is_dir);
            if score >= bar {
                into.push((score, hit));
            }
        }
    };
    let mut seen = HashSet::new();
    let mut scored = Vec::new();
    let prefix = prefix_query(fields, &tokens, scope);
    rank(
        gather(&searcher, prefix.as_ref(), PREFIX_CANDIDATES)?,
        &mut seen,
        &mut scored,
    );
    if !current() {
        return Ok(Err(Superseded));
    }
    if scored.len() < limit {
        let fuzzy = fuzzy_query(fields, &tokens, scope);
        rank(
            gather(&searcher, fuzzy.as_ref(), FUZZY_CANDIDATES)?,
            &mut seen,
            &mut scored,
        );
        if !current() {
            return Ok(Err(Superseded));
        }
    }
    scored.sort_by(|(left_score, left), (right_score, right)| {
        right_score
            .partial_cmp(left_score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(Ok(scored.into_iter().map(|(_, hit)| hit).collect()))
}

fn score(query: &str, name: &str, is_dir: bool) -> f32 {
    let name = normalize_case(name);
    let mut score = if name == query {
        1.0
    } else if name.starts_with(query) {
        0.92
    } else if name.contains(query) {
        0.82
    } else {
        token_score(query, &name)
    };
    if is_dir {
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
    use super::super::catalog::{build_schema, doc_at, put_doc};
    use super::*;
    use tantivy::{Index, IndexWriter};

    fn finds(query: &str, name: &str) -> bool {
        let query = normalize_case(query);
        score(&query, name, false) >= min_score(query.chars().count())
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
        let exact = score("notes", "notes", false);
        let prefix = score("notes", "notes from monday", false);
        let part = score("notes", "my notes", false);
        assert!(exact > prefix && prefix > part);
    }

    fn indexed(names: &[&str]) -> (IndexReader, Fields) {
        let (schema, fields) = build_schema();
        let index = Index::create_in_ram(schema);
        let mut writer: IndexWriter = index.writer_with_num_threads(1, 15_000_000).unwrap();
        for name in names {
            let path = format!("/home/me/{name}");
            let doc = doc_at(Path::new(&path), true, false, 1, None).unwrap();
            put_doc(&writer, &fields, &doc).unwrap();
        }
        writer.commit().unwrap();
        let reader = index.reader().unwrap();
        (reader, fields)
    }

    fn names(
        reader: &IndexReader,
        fields: &Fields,
        query: &str,
        scope: Option<&Path>,
    ) -> Vec<String> {
        let Ok(Ok(hits)) = matches(reader, fields, query, scope, 50, &|| true) else {
            panic!("the search should run");
        };
        hits.into_iter().map(|hit| hit.name).collect()
    }

    #[test]
    fn a_prefix_query_ranks_the_exact_name_then_prefixes_then_parts() {
        let (reader, fields) = indexed(&[
            "my notes.txt",
            "notebook.pdf",
            "notes",
            "notes from monday.txt",
            "invoice.pdf",
            ".notes-hidden",
        ]);
        let found = names(&reader, &fields, "notes", None);
        assert_eq!(found[0], "notes");
        assert!(found.contains(&"my notes.txt".to_owned()));
        let part = found
            .iter()
            .position(|name| name == "my notes.txt")
            .unwrap();
        let prefix = found
            .iter()
            .position(|name| name == "notes from monday.txt")
            .unwrap();
        assert!(prefix < part);
        assert!(!found.contains(&"invoice.pdf".to_owned()));
        assert!(!found.contains(&".notes-hidden".to_owned()));
        let started = names(&reader, &fields, "note", None);
        assert!(started.contains(&"notebook.pdf".to_owned()));
        assert!(started.contains(&"notes".to_owned()));
    }

    #[test]
    fn a_scope_keeps_results_inside_its_folder_and_a_newer_search_stops_an_older_one() {
        let (reader, fields) = indexed(&["report.txt", "work/report-2026.txt"]);
        let inside = names(&reader, &fields, "report", Some(Path::new("/home/me/work")));
        assert_eq!(inside, ["report-2026.txt"]);
        assert!(matches!(
            matches(&reader, &fields, "report", None, 50, &|| false),
            Ok(Err(Superseded))
        ));
    }
}
