//! Postgres values as JSON the grid can show and send back. Rows arrive in the binary format, so
//! each type is read by its own rule: the driver's own decoders where it has one, a few formats
//! read by hand (numeric, uuid, interval, inet, money, timetz), and anything else as its text, or
//! as `\x` hex when it isn't text.

use std::error::Error;
use std::fmt::Write as _;
use std::net::{Ipv4Addr, Ipv6Addr};

use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, SecondsFormat, Utc};
use serde_json::Value;
use tokio_postgres::types::{FromSql, Kind, Type};
use tokio_postgres::Row;

use super::types::{bytes, float, integer};

/// A value's raw bytes, whatever its type, for the decoders below.
pub struct Raw<'a>(pub &'a [u8]);

impl<'a> FromSql<'a> for Raw<'a> {
    fn from_sql(_: &Type, raw: &'a [u8]) -> Result<Self, Box<dyn Error + Sync + Send>> {
        Ok(Raw(raw))
    }

    fn accepts(_: &Type) -> bool {
        true
    }
}

/// The value in `row` at `index`, whose column is of type `ty`.
pub fn cell(row: &Row, index: usize, ty: &Type) -> Value {
    match row.try_get::<_, Option<Raw<'_>>>(index) {
        Ok(Some(raw)) => decode(ty, raw.0),
        _ => Value::Null,
    }
}

fn typed<'a, T: FromSql<'a>>(ty: &Type, raw: &'a [u8]) -> Option<T> {
    T::from_sql(ty, raw).ok()
}

fn text(raw: &[u8]) -> Value {
    match std::str::from_utf8(raw) {
        Ok(text) => Value::String(text.to_string()),
        Err(_) => bytes(raw),
    }
}

pub fn decode(ty: &Type, raw: &[u8]) -> Value {
    match ty.kind() {
        Kind::Array(member) => return array(ty, member, raw),
        Kind::Domain(base) => return decode(base, raw),
        // An enum's binary form is its label.
        Kind::Enum(_) => return text(raw),
        _ => {}
    }
    let decoded = if *ty == Type::BOOL {
        typed::<bool>(ty, raw).map(Value::Bool)
    } else if *ty == Type::INT2 {
        typed::<i16>(ty, raw).map(Value::from)
    } else if *ty == Type::INT4 {
        typed::<i32>(ty, raw).map(Value::from)
    } else if *ty == Type::INT8 {
        typed::<i64>(ty, raw).map(integer)
    } else if *ty == Type::OID {
        typed::<u32>(ty, raw).map(Value::from)
    } else if *ty == Type::CHAR {
        typed::<i8>(ty, raw).map(|code| Value::String(char::from(code as u8).to_string()))
    } else if *ty == Type::FLOAT4 {
        // Through its own shortest text, so 0.1 stays 0.1 rather than 0.10000000149.
        typed::<f32>(ty, raw).map(|number| {
            float(
                number
                    .to_string()
                    .parse::<f64>()
                    .unwrap_or(f64::from(number)),
            )
        })
    } else if *ty == Type::FLOAT8 {
        typed::<f64>(ty, raw).map(float)
    } else if *ty == Type::NUMERIC {
        numeric(raw).map(Value::String)
    } else if *ty == Type::MONEY {
        money(raw).map(Value::String)
    } else if *ty == Type::BYTEA {
        Some(bytes(raw))
    } else if *ty == Type::JSON || *ty == Type::JSONB {
        typed::<Value>(ty, raw)
    } else if *ty == Type::TIMESTAMP {
        typed::<NaiveDateTime>(ty, raw)
            .map(|time| Value::String(time.format("%Y-%m-%dT%H:%M:%S%.f").to_string()))
    } else if *ty == Type::TIMESTAMPTZ {
        typed::<DateTime<Utc>>(ty, raw)
            .map(|time| Value::String(time.to_rfc3339_opts(SecondsFormat::AutoSi, true)))
    } else if *ty == Type::DATE {
        typed::<NaiveDate>(ty, raw).map(|date| Value::String(date.format("%Y-%m-%d").to_string()))
    } else if *ty == Type::TIME {
        typed::<NaiveTime>(ty, raw)
            .map(|time| Value::String(time.format("%H:%M:%S%.f").to_string()))
    } else if *ty == Type::TIMETZ {
        timetz(raw).map(Value::String)
    } else if *ty == Type::UUID {
        uuid(raw).map(Value::String)
    } else if *ty == Type::INTERVAL {
        interval(raw).map(Value::String)
    } else if *ty == Type::INET || *ty == Type::CIDR {
        inet(raw).map(Value::String)
    } else {
        None
    };
    decoded
        .or_else(|| infinity(ty, raw))
        .unwrap_or_else(|| text(raw))
}

fn array(ty: &Type, member: &Type, raw: &[u8]) -> Value {
    match Vec::<Option<Raw<'_>>>::from_sql(ty, raw) {
        Ok(items) => Value::Array(
            items
                .into_iter()
                .map(|item| item.map_or(Value::Null, |raw| decode(member, raw.0)))
                .collect(),
        ),
        // An array of more than one dimension.
        Err(_) => bytes(raw),
    }
}

fn be_i64(raw: &[u8]) -> Option<i64> {
    Some(i64::from_be_bytes(raw.get(..8)?.try_into().ok()?))
}

fn be_i32(raw: &[u8]) -> Option<i32> {
    Some(i32::from_be_bytes(raw.get(..4)?.try_into().ok()?))
}

fn be_u16(raw: &[u8]) -> Option<u16> {
    Some(u16::from_be_bytes(raw.get(..2)?.try_into().ok()?))
}

/// Timestamps and dates past chrono's range: Postgres's `infinity` and `-infinity`.
fn infinity(ty: &Type, raw: &[u8]) -> Option<Value> {
    let (high, low) = if *ty == Type::TIMESTAMP || *ty == Type::TIMESTAMPTZ {
        let value = be_i64(raw)?;
        (value == i64::MAX, value == i64::MIN)
    } else if *ty == Type::DATE {
        let value = be_i32(raw)?;
        (value == i32::MAX, value == i32::MIN)
    } else {
        return None;
    };
    match (high, low) {
        (true, _) => Some(Value::String("infinity".into())),
        (_, true) => Some(Value::String("-infinity".into())),
        _ => None,
    }
}

/// `numeric`: base-10000 digit groups with a weight, a sign and a display scale.
fn numeric(raw: &[u8]) -> Option<String> {
    let count = be_u16(raw)? as usize;
    let weight = i32::from(be_u16(raw.get(2..)?)? as i16);
    let sign = be_u16(raw.get(4..)?)?;
    let scale = be_u16(raw.get(6..)?)? as usize;
    match sign {
        0xC000 => return Some("NaN".into()),
        0xD000 => return Some("Infinity".into()),
        0xF000 => return Some("-Infinity".into()),
        0x0000 | 0x4000 => {}
        _ => return None,
    }
    let digits: Vec<u16> = (0..count)
        .map(|index| be_u16(raw.get(8 + index * 2..)?))
        .collect::<Option<_>>()?;
    let digit = |index: i32| {
        usize::try_from(index)
            .ok()
            .and_then(|index| digits.get(index).copied())
            .unwrap_or(0)
    };
    let mut out = String::new();
    if sign == 0x4000 {
        out.push('-');
    }
    if weight < 0 {
        out.push('0');
    } else {
        for index in 0..=weight {
            let group = digit(index);
            let _ = if index == 0 {
                write!(out, "{group}")
            } else {
                write!(out, "{group:04}")
            };
        }
    }
    if scale > 0 {
        let mut fraction = String::new();
        let mut index = weight + 1;
        while fraction.len() < scale {
            let _ = write!(fraction, "{:04}", digit(index));
            index += 1;
        }
        fraction.truncate(scale);
        out.push('.');
        out.push_str(&fraction);
    }
    Some(out)
}

/// `money`: whole cents. The server's locale decides its symbol, which the grid leaves off.
fn money(raw: &[u8]) -> Option<String> {
    let cents = be_i64(raw)?;
    let sign = if cents < 0 { "-" } else { "" };
    let cents = cents.unsigned_abs();
    Some(format!("{sign}{}.{:02}", cents / 100, cents % 100))
}

fn uuid(raw: &[u8]) -> Option<String> {
    if raw.len() != 16 {
        return None;
    }
    let hex = hex::encode(raw);
    Some(format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    ))
}

/// `HH:MM:SS` with any fraction of a second, from microseconds since midnight.
fn clock(micros: i64) -> String {
    let total = micros.unsigned_abs();
    let seconds = total / 1_000_000;
    let fraction = total % 1_000_000;
    let mut out = format!(
        "{:02}:{:02}:{:02}",
        seconds / 3600,
        (seconds / 60) % 60,
        seconds % 60
    );
    if fraction > 0 {
        let digits = format!("{fraction:06}");
        out.push('.');
        out.push_str(digits.trim_end_matches('0'));
    }
    out
}

/// `interval` the way Postgres writes it: `1 year 2 mons 3 days 04:05:06`.
fn interval(raw: &[u8]) -> Option<String> {
    if raw.len() != 16 {
        return None;
    }
    let micros = be_i64(raw)?;
    let days = be_i32(raw.get(8..)?)?;
    let months = be_i32(raw.get(12..)?)?;
    let unit = |count: i32, one: &str, many: &str| {
        format!("{count} {}", if count.abs() == 1 { one } else { many })
    };
    let mut parts = Vec::new();
    if months / 12 != 0 {
        parts.push(unit(months / 12, "year", "years"));
    }
    if months % 12 != 0 {
        parts.push(unit(months % 12, "mon", "mons"));
    }
    if days != 0 {
        parts.push(unit(days, "day", "days"));
    }
    if micros != 0 || parts.is_empty() {
        let sign = if micros < 0 { "-" } else { "" };
        parts.push(format!("{sign}{}", clock(micros)));
    }
    Some(parts.join(" "))
}

/// `timetz`: microseconds since midnight and the zone's offset in seconds west of UTC.
fn timetz(raw: &[u8]) -> Option<String> {
    if raw.len() != 12 {
        return None;
    }
    let micros = be_i64(raw)?;
    let east = -be_i32(raw.get(8..)?)?;
    let sign = if east < 0 { '-' } else { '+' };
    let offset = east.unsigned_abs();
    let mut zone = format!("{sign}{:02}", offset / 3600);
    if offset % 3600 != 0 {
        let _ = write!(zone, ":{:02}", (offset / 60) % 60);
    }
    Some(format!("{}{zone}", clock(micros)))
}

/// `inet` and `cidr`: a family, the prefix length, whether it's a network, and the address.
fn inet(raw: &[u8]) -> Option<String> {
    let family = *raw.first()?;
    let bits = *raw.get(1)?;
    let network = *raw.get(2)? != 0;
    let address = raw.get(4..)?;
    let (text, full) = match (family, address.len()) {
        (2, 4) => (
            Ipv4Addr::from(<[u8; 4]>::try_from(address).ok()?).to_string(),
            32,
        ),
        (3, 16) => (
            Ipv6Addr::from(<[u8; 16]>::try_from(address).ok()?).to_string(),
            128,
        ),
        _ => return None,
    };
    Some(if network || bits != full {
        format!("{text}/{bits}")
    } else {
        text
    })
}
