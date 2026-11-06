//! The `ajv-formats` checks ("full" mode) that tool schemas use. An unknown format would have failed
//! Ajv's compile in strict mode and stopped the step. Here it checks nothing, because the catalog is
//! the server's and the server enforces its own schemas before it runs a tool.
use std::sync::LazyLock;

use regex::Regex;

use crate::runtime::js_regex::js_regex;

static UUID: LazyLock<Regex> = LazyLock::new(|| js_regex(r"^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$", true));
static DATE: LazyLock<Regex> = LazyLock::new(|| js_regex(r"^(\d\d\d\d)-(\d\d)-(\d\d)$", false));
static TIME: LazyLock<Regex> = LazyLock::new(|| js_regex(r"^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$", true));
static EMAIL: LazyLock<Regex> = LazyLock::new(|| {
    js_regex(r"^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$", true)
});
static HOSTNAME: LazyLock<Regex> = LazyLock::new(|| js_regex(r"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$", true));
static IPV4: LazyLock<Regex> = LazyLock::new(|| js_regex(r"^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$", false));

fn leap(year: u32) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

fn date(text: &str) -> bool {
    let Some(parts) = DATE.captures(text) else {
        return false;
    };
    let number = |index: usize| parts.get(index).and_then(|part| part.as_str().parse::<u32>().ok()).unwrap_or(0);
    let (year, month, day) = (number(1), number(2), number(3));
    let days = [31, if leap(year) { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    (1..=12).contains(&month) && day >= 1 && day <= days[month as usize - 1]
}

/// `ajv-formats`' strict time: needs a zone, and takes a leap second only at the end of a UTC minute.
fn time(text: &str) -> bool {
    let Some(parts) = TIME.captures(text) else {
        return false;
    };
    let number = |index: usize| parts.get(index).and_then(|part| part.as_str().parse::<f64>().ok());
    let (Some(hour), Some(minute), Some(second)) = (number(1), number(2), number(3)) else {
        return false;
    };
    if parts.get(4).is_none() {
        return false;
    }
    let sign = if parts.get(5).is_some_and(|sign| sign.as_str() == "-") { -1.0 } else { 1.0 };
    let (zone_hour, zone_minute) = (number(6).unwrap_or(0.0), number(7).unwrap_or(0.0));
    if zone_hour > 23.0 || zone_minute > 59.0 {
        return false;
    }
    if hour <= 23.0 && minute <= 59.0 && second < 60.0 {
        return true;
    }
    let utc_minute = minute - zone_minute * sign;
    let utc_hour = hour - zone_hour * sign - if utc_minute < 0.0 { 1.0 } else { 0.0 };
    (utc_hour == 23.0 || utc_hour == -1.0) && (utc_minute == 59.0 || utc_minute == -1.0) && second < 61.0
}

fn date_time(text: &str) -> bool {
    let Some(at) = text.find(['t', 'T', ' ']) else {
        return false;
    };
    date(&text[..at]) && time(&text[at + 1..])
}

fn uri(text: &str) -> bool {
    !text.chars().any(char::is_whitespace) && url::Url::parse(text).is_ok()
}

fn byte(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.len() % 4 == 0 && {
        let body = text.trim_end_matches('=');
        bytes.len() - body.len() <= 2 && body.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/'))
    }
}

pub(super) fn format_matches(format: &str, text: &str) -> bool {
    match format {
        "uuid" => UUID.is_match(text),
        "date" => date(text),
        "time" => time(text),
        "date-time" => date_time(text),
        "email" => EMAIL.is_match(text),
        "hostname" => HOSTNAME.is_match(text),
        "ipv4" => IPV4.is_match(text),
        "ipv6" => text.contains(':') && text.parse::<std::net::Ipv6Addr>().is_ok(),
        "uri" | "url" => uri(text),
        "byte" => byte(text),
        _ => true,
    }
}
