//! Addresses and payment cards the person saved to fill into forms (`autofill` collection).
//! Native-only, like sign-ins: sealed with the vault key and never projected to a renderer as
//! records. A card keeps no security code, ever. There is deliberately no `Debug` here, so neither
//! can reach a log by accident.
use super::*;

/// One saved address. Every part is optional because forms and countries ask for different ones;
/// `validate` only refuses a record with nothing to fill.
#[derive(Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Address {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub organization: String,
    /// Street lines, separated by newlines.
    #[serde(default)]
    pub street: String,
    #[serde(default)]
    pub city: String,
    /// State, province or county, as the person wrote it.
    #[serde(default)]
    pub region: String,
    #[serde(default)]
    pub postal_code: String,
    #[serde(default)]
    pub country: String,
    #[serde(default)]
    pub phone: String,
    #[serde(default)]
    pub email: String,
    /// Milliseconds since the Unix epoch.
    pub created_at: i64,
    pub updated_at: i64,
}

impl Address {
    /// Every part that holds text, for the checks that treat them alike.
    pub fn parts(&self) -> [&str; 9] {
        [
            &self.name,
            &self.organization,
            &self.street,
            &self.city,
            &self.region,
            &self.postal_code,
            &self.country,
            &self.phone,
            &self.email,
        ]
    }
}

/// One saved payment card: digits only in `number`, and never a security code.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Card {
    pub number: String,
    #[serde(default)]
    pub holder: String,
    pub exp_month: u8,
    pub exp_year: u16,
    /// Milliseconds since the Unix epoch.
    pub created_at: i64,
    pub updated_at: i64,
}

/// A card number the way every card scheme writes one: 12 to 19 digits passing the Luhn check.
pub fn card_number_valid(number: &str) -> bool {
    if !(12..=19).contains(&number.len()) || !number.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    let sum: u32 = number
        .bytes()
        .rev()
        .enumerate()
        .map(|(index, byte)| {
            let digit = u32::from(byte - b'0');
            match (index % 2 == 1, digit * 2) {
                (false, _) => digit,
                (true, doubled) if doubled > 9 => doubled - 9,
                (true, doubled) => doubled,
            }
        })
        .sum();
    sum % 10 == 0
}

pub(super) fn validate_address(address: &Address) -> Result<()> {
    text(&address.street, 1024, true)?;
    for part in address.parts() {
        text(part, 1024, true)?;
    }
    for part in [
        &address.name,
        &address.organization,
        &address.city,
        &address.region,
        &address.postal_code,
        &address.country,
        &address.phone,
        &address.email,
    ] {
        if part.len() > 256 || part.contains('\n') {
            return Err(Error::Invalid);
        }
    }
    if address.parts().iter().all(|part| part.trim().is_empty()) {
        return Err(Error::Invalid);
    }
    added_at(Some(address.created_at))?;
    added_at(Some(address.updated_at))
}

pub(super) fn validate_card(card: &Card) -> Result<()> {
    text(&card.holder, 256, true)?;
    if !card_number_valid(&card.number)
        || !(1..=12).contains(&card.exp_month)
        || !(2000..=2200).contains(&card.exp_year)
        || card.holder.contains('\n')
    {
        return Err(Error::Invalid);
    }
    added_at(Some(card.created_at))?;
    added_at(Some(card.updated_at))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fields<T: Serialize>(value: &T) -> Fields {
        let Value::Object(fields) = serde_json::to_value(value).unwrap() else {
            panic!("records are objects");
        };
        fields.into_iter().collect()
    }

    fn card(number: &str) -> Card {
        Card {
            number: number.to_owned(),
            holder: "Ada Lovelace".to_owned(),
            exp_month: 12,
            exp_year: 2031,
            created_at: 1,
            updated_at: 1,
        }
    }

    #[test]
    fn luhn_accepts_test_cards_and_refuses_typos() {
        for good in ["4242424242424242", "5555555555554444", "378282246310005"] {
            assert!(card_number_valid(good), "{good}");
        }
        for bad in [
            "4242424242424241",
            "1234",
            "4242 4242 4242 4242",
            "",
            "42424242424242424242",
        ] {
            assert!(!card_number_valid(bad), "{bad}");
        }
    }

    #[test]
    fn a_card_never_accepts_a_security_code() {
        let mut record = fields(&card("4242424242424242"));
        assert!(validate(Kind::Card, &record).is_ok());
        record.insert("cvc".to_owned(), Value::String("123".to_owned()));
        assert!(validate(Kind::Card, &record).is_err());
    }

    #[test]
    fn a_card_needs_a_real_number_and_expiry() {
        assert!(validate(Kind::Card, &fields(&card("4242424242424241"))).is_err());
        let mut month = card("4242424242424242");
        month.exp_month = 13;
        assert!(validate(Kind::Card, &fields(&month)).is_err());
    }

    #[test]
    fn an_address_needs_something_to_fill_and_single_line_parts() {
        let empty = Address {
            created_at: 1,
            updated_at: 1,
            ..Address::default()
        };
        assert!(validate(Kind::Address, &fields(&empty)).is_err());
        let street = Address {
            street: "1 Main St\nApt 2".to_owned(),
            ..empty.clone()
        };
        assert!(validate(Kind::Address, &fields(&street)).is_ok());
        let split_city = Address {
            city: "Spring\nfield".to_owned(),
            ..empty
        };
        assert!(validate(Kind::Address, &fields(&split_city)).is_err());
    }
}
