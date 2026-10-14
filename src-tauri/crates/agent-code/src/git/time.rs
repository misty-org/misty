//! Git keeps time as seconds since the epoch plus a ±HHMM offset; GitHub's API
//! speaks ISO 8601. These convert between the two without a date library.

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let month_index = (month + 9) % 12;
    let day_of_year = (153 * month_index + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let days = days + 719_468;
    let era = if days >= 0 { days } else { days - 146_096 } / 146_097;
    let day_of_era = days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 { month_index + 3 } else { month_index - 9 };
    let year = year_of_era + era * 400 + if month <= 2 { 1 } else { 0 };
    (year, month, day)
}

/// `2026-10-11T20:00:00-07:00` for a moment and its offset in minutes.
pub fn iso(seconds: i64, offset_minutes: i32) -> String {
    let local = seconds + offset_minutes as i64 * 60;
    let (year, month, day) = civil_from_days(local.div_euclid(86_400));
    let in_day = local.rem_euclid(86_400);
    let sign = if offset_minutes < 0 { '-' } else { '+' };
    let offset = offset_minutes.unsigned_abs();
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}{sign}{:02}:{:02}",
        in_day / 3_600,
        in_day % 3_600 / 60,
        in_day % 60,
        offset / 60,
        offset % 60
    )
}

/// Seconds since the epoch for an ISO 8601 time with `Z` or an offset.
pub fn parse_iso(text: &str) -> Option<i64> {
    let text = text.trim();
    let (date, rest) = text.split_once('T')?;
    let mut date_parts = date.split('-');
    let year: i64 = date_parts.next()?.parse().ok()?;
    let month: i64 = date_parts.next()?.parse().ok()?;
    let day: i64 = date_parts.next()?.parse().ok()?;
    let (clock, offset) = if let Some(clock) = rest.strip_suffix('Z') {
        (clock, 0)
    } else {
        let split = rest.rfind(['+', '-'])?;
        let (clock, zone) = rest.split_at(split);
        let sign = if zone.starts_with('-') { -1 } else { 1 };
        let (hours, minutes) = zone[1..].split_once(':').unwrap_or((&zone[1..3], &zone[3..]));
        (clock, sign * (hours.parse::<i64>().ok()? * 60 + minutes.parse::<i64>().ok()?))
    };
    let clock = clock.split('.').next()?;
    let mut clock_parts = clock.split(':');
    let hour: i64 = clock_parts.next()?.parse().ok()?;
    let minute: i64 = clock_parts.next()?.parse().ok()?;
    let second: i64 = clock_parts.next().unwrap_or("0").parse().ok()?;
    Some(days_from_civil(year, month, day) * 86_400 + hour * 3_600 + minute * 60 + second - offset * 60)
}

/// `-0700` style offsets as Git writes them.
pub fn git_offset(offset_minutes: i32) -> String {
    let sign = if offset_minutes < 0 { '-' } else { '+' };
    let offset = offset_minutes.unsigned_abs();
    format!("{sign}{:02}{:02}", offset / 60, offset % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips() {
        assert_eq!(iso(1_791_774_000, -420), "2026-10-11T20:00:00-07:00");
        assert_eq!(parse_iso("2026-10-12T03:00:00Z"), Some(1_791_774_000));
        assert_eq!(parse_iso("2026-10-11T20:00:00-07:00"), Some(1_791_774_000));
        assert_eq!(parse_iso("2026-10-12T08:30:00+05:30"), Some(1_791_774_000));
        assert_eq!(iso(0, 0), "1970-01-01T00:00:00+00:00");
        assert_eq!(git_offset(-420), "-0700");
        assert_eq!(git_offset(345), "+0545");
    }
}
