//! What a submitted form means for saved addresses and cards. No I/O: everything here takes the
//! form and the saved records and answers, so it can be tested without a page or a vault.
use misty_browser_sync::document::entities::{card_number_valid, Address, Card};
use serde::Deserialize;

/// What the page script read from a submitted form. Page data: nothing here is trusted until
/// `address_to_save` or `card_to_save` has checked it.
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(super) struct CapturedForm {
    pub address: Option<CapturedAddress>,
    pub card: Option<CapturedCard>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(super) struct CapturedAddress {
    pub name: String,
    pub organization: String,
    pub street: String,
    pub city: String,
    pub region: String,
    pub postal_code: String,
    pub country: String,
    pub phone: String,
    pub email: String,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(super) struct CapturedCard {
    pub number: String,
    pub holder: String,
    pub exp_month: u32,
    pub exp_year: u32,
}

fn normalized(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn lines(text: &str) -> String {
    text.lines()
        .map(line)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn same_place(left: &Address, right: &Address) -> bool {
    normalized(&left.street) == normalized(&right.street)
        && normalized(&left.postal_code) == normalized(&right.postal_code)
}

/// A captured address as a record, or nothing when the form wasn't really an address: a street
/// and a city or postal code are the least that says so.
fn address_from(captured: &CapturedAddress, now: i64) -> Option<Address> {
    let address = Address {
        name: line(&captured.name),
        organization: line(&captured.organization),
        street: lines(&captured.street),
        city: line(&captured.city),
        region: line(&captured.region),
        postal_code: line(&captured.postal_code),
        country: line(&captured.country),
        phone: line(&captured.phone),
        email: line(&captured.email),
        created_at: now,
        updated_at: now,
    };
    (!address.street.is_empty() && !(address.city.is_empty() && address.postal_code.is_empty()))
        .then_some(address)
}

/// The record to offer saving and the id it would replace, if any. `None` when the form adds
/// nothing to what's saved, so a person isn't asked about an address Misty just filled.
pub(super) fn address_to_save(
    captured: &CapturedAddress,
    saved: &[(String, Address)],
    now: i64,
) -> Option<(Option<String>, Address)> {
    let mut address = address_from(captured, now)?;
    let Some((id, existing)) = saved.iter().find(|(_, old)| same_place(old, &address)) else {
        return Some((None, address));
    };
    // A form that asks for less keeps what's saved rather than blanking it.
    let keep = |new: &mut String, old: &String| {
        if new.is_empty() {
            new.clone_from(old);
        }
    };
    keep(&mut address.name, &existing.name);
    keep(&mut address.organization, &existing.organization);
    keep(&mut address.city, &existing.city);
    keep(&mut address.region, &existing.region);
    keep(&mut address.country, &existing.country);
    keep(&mut address.phone, &existing.phone);
    keep(&mut address.email, &existing.email);
    address.created_at = existing.created_at;
    address.updated_at = existing.updated_at;
    if address == *existing {
        return None;
    }
    address.updated_at = now;
    Some((Some(id.clone()), address))
}

/// Digits and a real expiry, or nothing. Two-digit years mean this century.
fn card_from(captured: &CapturedCard, now: i64) -> Option<Card> {
    let number: String = captured
        .number
        .chars()
        .filter(|c| !matches!(c, ' ' | '-'))
        .collect();
    let exp_year = match captured.exp_year {
        year @ 0..=99 => year + 2000,
        year => year,
    };
    (card_number_valid(&number)
        && (1..=12).contains(&captured.exp_month)
        && (2000..=2200).contains(&exp_year))
    .then(|| Card {
        number,
        holder: line(&captured.holder),
        exp_month: captured.exp_month as u8,
        exp_year: exp_year as u16,
        created_at: now,
        updated_at: now,
    })
}

/// As `address_to_save`, for a card: the number is what makes it the same card.
pub(super) fn card_to_save(
    captured: &CapturedCard,
    saved: &[(String, Card)],
    now: i64,
) -> Option<(Option<String>, Card)> {
    let mut card = card_from(captured, now)?;
    let Some((id, existing)) = saved.iter().find(|(_, old)| old.number == card.number) else {
        return Some((None, card));
    };
    if card.holder.is_empty() {
        card.holder.clone_from(&existing.holder);
    }
    card.created_at = existing.created_at;
    card.updated_at = existing.updated_at;
    if card == *existing {
        return None;
    }
    card.updated_at = now;
    Some((Some(id.clone()), card))
}

/// The card's network from its leading digits, only ever to name it to the person.
pub(super) fn card_brand(number: &str) -> &'static str {
    let prefix = |length: usize| number.get(..length).and_then(|p| p.parse::<u32>().ok());
    match (prefix(1), prefix(2), prefix(3), prefix(4)) {
        (Some(4), ..) => "Visa",
        (_, Some(34 | 37), ..) => "American Express",
        (_, Some(51..=55), ..) => "Mastercard",
        (.., Some(2221..=2720)) => "Mastercard",
        (_, Some(65), ..) | (_, _, Some(644..=649), _) | (.., Some(6011)) => "Discover",
        _ => "Card",
    }
}

/// The last four digits, which is all of the number that ever leaves native code as a label.
pub(super) fn card_last4(number: &str) -> &str {
    number.get(number.len().saturating_sub(4)..).unwrap_or("")
}

/// `Visa ending in 4242`: how a card is named everywhere outside native code.
pub(super) fn card_label(card: &Card) -> String {
    format!(
        "{} ending in {}",
        card_brand(&card.number),
        card_last4(&card.number)
    )
}

/// The first line a person would recognize an address by.
pub(super) fn address_label(address: &Address) -> String {
    [
        address.street.lines().next().unwrap_or(""),
        address.city.as_str(),
    ]
    .into_iter()
    .filter(|part| !part.is_empty())
    .collect::<Vec<_>>()
    .join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;

    const VISA: &str = "4242424242424242";

    fn captured_address() -> CapturedAddress {
        CapturedAddress {
            name: "Ada  Lovelace".into(),
            street: " 1 Main St \n\n Apt 2 ".into(),
            city: "Springfield".into(),
            postal_code: "12345".into(),
            ..Default::default()
        }
    }

    fn captured_card() -> CapturedCard {
        CapturedCard {
            number: "4242 4242-4242 4242".into(),
            holder: "Ada Lovelace".into(),
            exp_month: 12,
            exp_year: 31,
        }
    }

    #[test]
    fn a_form_without_a_street_and_place_is_not_an_address() {
        let contact = CapturedAddress {
            name: "Ada".into(),
            email: "ada@example.com".into(),
            ..Default::default()
        };
        assert!(address_to_save(&contact, &[], 1).is_none());
        let street_only = CapturedAddress {
            street: "1 Main St".into(),
            ..Default::default()
        };
        assert!(address_to_save(&street_only, &[], 1).is_none());
    }

    #[test]
    fn a_new_address_is_tidied_and_has_no_id() {
        let (id, address) = address_to_save(&captured_address(), &[], 5).unwrap();
        assert!(id.is_none());
        assert_eq!(address.name, "Ada Lovelace");
        assert_eq!(address.street, "1 Main St\nApt 2");
        assert_eq!(address.created_at, 5);
    }

    #[test]
    fn the_same_address_again_asks_nothing() {
        let (_, saved) = address_to_save(&captured_address(), &[], 5).unwrap();
        assert!(address_to_save(&captured_address(), &[("a".into(), saved)], 9).is_none());
    }

    #[test]
    fn a_form_asking_for_less_keeps_what_is_saved_and_asks_nothing() {
        let mut full = captured_address();
        full.phone = "555 0100".into();
        let (_, saved) = address_to_save(&full, &[], 5).unwrap();
        assert!(address_to_save(&captured_address(), &[("a".into(), saved)], 9).is_none());
    }

    #[test]
    fn new_details_update_the_saved_address_in_place() {
        let (_, saved) = address_to_save(&captured_address(), &[], 5).unwrap();
        let mut changed = captured_address();
        changed.phone = "555 0100".into();
        let (id, address) = address_to_save(&changed, &[("a".into(), saved)], 9).unwrap();
        assert_eq!(id.as_deref(), Some("a"));
        assert_eq!(address.phone, "555 0100");
        assert_eq!((address.created_at, address.updated_at), (5, 9));
    }

    #[test]
    fn a_card_is_stripped_to_digits_with_a_full_year() {
        let (id, card) = card_to_save(&captured_card(), &[], 5).unwrap();
        assert!(id.is_none());
        assert_eq!(card.number, VISA);
        assert_eq!((card.exp_month, card.exp_year), (12, 2031));
    }

    #[test]
    fn typos_and_impossible_expiries_are_not_cards() {
        let mut typo = captured_card();
        typo.number = "4242424242424241".into();
        assert!(card_to_save(&typo, &[], 1).is_none());
        let mut month = captured_card();
        month.exp_month = 13;
        assert!(card_to_save(&month, &[], 1).is_none());
        let mut letters = captured_card();
        letters.number = "not a card number".into();
        assert!(card_to_save(&letters, &[], 1).is_none());
    }

    #[test]
    fn the_same_card_asks_nothing_and_a_new_expiry_updates_it() {
        let (_, saved) = card_to_save(&captured_card(), &[], 5).unwrap();
        let list = [("c".to_owned(), saved)];
        assert!(card_to_save(&captured_card(), &list, 9).is_none());
        let mut renewed = captured_card();
        renewed.exp_year = 33;
        let (id, card) = card_to_save(&renewed, &list, 9).unwrap();
        assert_eq!(id.as_deref(), Some("c"));
        assert_eq!(
            (card.exp_year, card.created_at, card.updated_at),
            (2033, 5, 9)
        );
    }

    #[test]
    fn labels_never_carry_more_than_the_last_four_digits() {
        let (_, card) = card_to_save(&captured_card(), &[], 5).unwrap();
        assert_eq!(card_label(&card), "Visa ending in 4242");
        assert!(!card_label(&card).contains("424242"));
    }

    #[test]
    fn brands_come_from_the_leading_digits() {
        assert_eq!(card_brand(VISA), "Visa");
        assert_eq!(card_brand("5555555555554444"), "Mastercard");
        assert_eq!(card_brand("2223003122003222"), "Mastercard");
        assert_eq!(card_brand("378282246310005"), "American Express");
        assert_eq!(card_brand("6011111111111117"), "Discover");
        assert_eq!(card_brand("9999999999999995"), "Card");
    }

    #[test]
    fn an_address_is_named_by_its_first_street_line_and_city() {
        let (_, address) = address_to_save(&captured_address(), &[], 5).unwrap();
        assert_eq!(address_label(&address), "1 Main St, Springfield");
    }
}
