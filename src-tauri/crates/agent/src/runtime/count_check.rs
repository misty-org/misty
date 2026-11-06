//! Counts the request asks for, checked against the answer without a model call
//! (docs/agents/harness.md, Completion). A run reported "completed" with 8 of the 10 pediatricians
//! asked for, and the model review let it stand (Odysseys, October 20).
//!
//! For each "at least N things" (or "N things", "around N things") in the request, the answer's
//! section whose heading names those things must list at least N items: list lines or table rows. A
//! request count the answer has no section for is left to the model review.
use std::sync::LazyLock;

use regex::Regex;

use super::{js_regex::js_regex, text::{js_len, js_prefix}};

const WORDS: [(&str, usize); 12] = [("two", 2), ("three", 3), ("four", 4), ("five", 5), ("six", 6), ("seven", 7), ("eight", 8), ("nine", 9), ("ten", 10), ("twelve", 12), ("fifteen", 15), ("twenty", 20)];
static ASKED: LazyLock<Regex> = LazyLock::new(|| {
    js_regex(
        r"\b(?:at least|minimum of|around|about|exactly|find|list|compare|open)?\s*(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)\s+(?:(?:different|distinct|separate|more|real|major|top|best|relevant|qualifying|[a-z]+-[a-z]+)\s+)?([a-z][a-z-]{3,})",
        true,
    )
});
/// Words that follow a number without naming things to list.
static NOT_THINGS: LazyLock<Regex> = LazyLock::new(|| js_regex(r"^(minutes?|hours?|days?|weeks?|months?|years?|times?|steps?|percent|dollars?|stars?|miles?|tabs?|pages?|sections?|sentences?|words?|points?|options?)$", true));
static ENDING: LazyLock<Regex> = LazyLock::new(|| js_regex(r"(ies|es|s)$", false));
static HEADING: LazyLock<Regex> = LazyLock::new(|| js_regex(r"^\s*(#{1,6}\s+(.+)|\*\*([^*]{3,120})\*\*:?\s*$)", false));
static LIST_ITEM: LazyLock<Regex> = LazyLock::new(|| js_regex(r"^\s*(?:[-*+]|\d+[.)])\s+\S", false));
static TABLE_ROW: LazyLock<Regex> = LazyLock::new(|| js_regex(r"^\s*\|.*\|\s*$", false));
static TABLE_RULE: LazyLock<Regex> = LazyLock::new(|| js_regex(r"^\s*\|[\s:|-]+\|\s*$", false));
static NOT_LETTER: LazyLock<Regex> = LazyLock::new(|| js_regex(r"[^a-z]+", false));

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct CountRequirement {
    pub(crate) count: usize,
    pub(crate) thing: String,
}

fn stem(word: &str) -> String {
    let lower = word.to_lowercase();
    js_prefix(&ENDING.replace(&lower, ""), 6).to_owned()
}

/// The counts a request asks for, at most one per thing, the largest.
pub(crate) fn requested_counts(request: &str) -> Vec<CountRequirement> {
    let mut found: Vec<(String, CountRequirement)> = Vec::new();
    for captures in ASKED.captures_iter(request) {
        let (Some(number), Some(thing)) = (captures.get(1), captures.get(2)) else {
            continue;
        };
        let lower = number.as_str().to_lowercase();
        let count = number
            .as_str()
            .parse::<usize>()
            .ok()
            .filter(|count| *count != 0)
            .or_else(|| WORDS.iter().find(|(word, _)| *word == lower).map(|(_, value)| *value))
            .unwrap_or(0);
        let thing = thing.as_str();
        if !(3..=50).contains(&count) || NOT_THINGS.is_match(thing) {
            continue;
        }
        let key = stem(thing);
        let requirement = CountRequirement { count, thing: thing.to_owned() };
        match found.iter_mut().find(|(known, _)| *known == key) {
            Some((_, existing)) if existing.count < count => *existing = requirement,
            Some(_) => {}
            None => found.push((key, requirement)),
        }
    }
    found.into_iter().map(|(_, requirement)| requirement).collect()
}

struct Section {
    heading: String,
    items: usize,
}

/// The answer's sections: a heading (markdown or a bold line) and the list items under it.
fn sections(answer: &str) -> Vec<Section> {
    let mut out: Vec<Section> = Vec::new();
    for line in answer.split('\n').map(|line| line.strip_suffix('\r').unwrap_or(line)) {
        if let Some(heading) = HEADING.captures(line) {
            let text = heading.get(2).or_else(|| heading.get(3)).map_or("", |found| found.as_str());
            out.push(Section { heading: text.to_lowercase(), items: 0 });
            continue;
        }
        let Some(current) = out.last_mut() else {
            continue;
        };
        if LIST_ITEM.is_match(line) || (TABLE_ROW.is_match(line) && !TABLE_RULE.is_match(line)) {
            current.items += 1;
        }
    }
    out
}

/// Requested counts the answer's matching section falls short of.
fn count_shortfalls(request: &str, answer: &str) -> Vec<(CountRequirement, usize)> {
    let parts = sections(answer);
    let mut short = Vec::new();
    for requirement in requested_counts(request) {
        let key = stem(&requirement.thing);
        let listed = parts
            .iter()
            .filter(|section| NOT_LETTER.split(&section.heading).any(|word| js_len(word) > 3 && stem(word) == key))
            .map(|section| section.items)
            .max();
        // A table's header row counts as a row, so one short is let through.
        if let Some(listed) = listed {
            if listed > 0 && listed + 1 < requirement.count {
                short.push((requirement, listed));
            }
        }
    }
    short
}

/// The note for a finish short of a requested count, or `None`.
pub(crate) fn count_refusal(request: &str, answer: &str) -> Option<String> {
    let short = count_shortfalls(request, answer);
    if short.is_empty() {
        return None;
    }
    let lines: Vec<String> = short
        .iter()
        .map(|(item, listed)| format!("the request asks for {} {} and your answer lists {listed}", item.count, item.thing))
        .collect();
    Some(format!("Counts: {}. Find and add the rest from pages you open, or say in remaining exactly how many you could confirm and why the others are missing.", lines.join("; ")))
}

#[cfg(test)]
mod tests {
    use super::*;

    const REQUEST: &str = "Find at least 10 pediatricians in Raleigh who accept one of those plans, then find around 10 daycare centers, and give me 3 sections.";

    fn rows(count: usize) -> String {
        (1..=count).map(|index| format!("- Item {index}")).collect::<Vec<_>>().join("\n")
    }

    #[test]
    fn reads_the_counts_a_request_asks_for() {
        assert_eq!(
            requested_counts(REQUEST),
            [
                CountRequirement { count: 10, thing: "pediatricians".to_owned() },
                CountRequirement { count: 10, thing: "daycare".to_owned() },
            ]
        );
    }

    #[test]
    fn flags_a_section_short_of_its_count_and_lets_a_full_one_through() {
        let short = format!("## Pediatricians\n{}\n\n## Daycare centers\n{}", rows(8), rows(10));
        assert!(count_refusal(REQUEST, &short).unwrap().contains("10 pediatricians and your answer lists 8"));
        assert_eq!(count_refusal(REQUEST, &format!("## Pediatricians\n{}\n\n## Daycare centers\n{}", rows(10), rows(9))), None);
        assert_eq!(count_refusal(REQUEST, "No sections at all."), None);
    }

    #[test]
    fn a_table_counts_its_rows_but_not_its_rule() {
        let table = "**Pediatricians**\n| a | b |\n| --- | --- |\n| 1 | 2 |\r\n| 3 | 4 |";
        assert!(count_refusal("Find at least 8 pediatricians", table).unwrap().contains("your answer lists 3"));
    }

    #[test]
    fn number_words_and_the_largest_count_win() {
        let asked = requested_counts("List five hotels, then compare twelve hotels and two cars.");
        assert_eq!(asked, [CountRequirement { count: 12, thing: "hotels".to_owned() }]);
    }
}
