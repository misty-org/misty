//! Commands from the Misty app itself: answering the chooser and the save offer, and managing
//! saved addresses and cards in Settings. A saved card number never comes back out of here.
use super::super::passwords::managed_profile;
use super::form::{card_brand, card_last4};
use super::*;
use misty_browser_sync::document::entities::card_number_valid;

/// A chooser unanswered this long no longer counts.
const CHOICE_SECONDS: u64 = 120;
/// Offers expire after ten minutes, like sign-ins.
const OFFER_SECONDS: u64 = 600;

/// The person's pick in the chooser, or `None` when they closed it.
#[tauri::command]
pub async fn browser_autofill_choose(
    webview: Webview,
    key: String,
    item: Option<String>,
) -> Result<(), String> {
    let profile = managed_profile(&webview)?;
    let choice = pending_choices()
        .lock()
        .ok()
        .and_then(|mut pending| pending.remove(&key));
    let Some(item) = item else {
        return Ok(());
    };
    let Some(choice) = choice.filter(|choice| {
        choice.at.elapsed().as_secs() < CHOICE_SECONDS && choice.profile == profile
    }) else {
        return Err("This is no longer waiting to be filled. Click the field again.".into());
    };
    fill(webview.app_handle(), &choice, &item).await
}

/// Saves (or drops) what a page's form just submitted.
#[tauri::command]
pub async fn browser_autofill_offer_respond(
    webview: Webview,
    id: String,
    save: bool,
) -> Result<(), String> {
    managed_profile(&webview)?;
    let waiting = pending_saves()
        .lock()
        .ok()
        .and_then(|mut pending| pending.remove(&id));
    let Some(waiting) = waiting.filter(|waiting| waiting.at.elapsed().as_secs() < OFFER_SECONDS)
    else {
        return if save {
            Err("This is no longer waiting to be saved.".into())
        } else {
            Ok(())
        };
    };
    if !save {
        return Ok(());
    }
    if let Some((record, address)) = &waiting.address {
        write_record(&waiting.profile, record.clone(), Kind::Address, address).await?;
    }
    if let Some((record, card)) = &waiting.card {
        write_record(&waiting.profile, record.clone(), Kind::Card, card).await?;
    }
    Ok(())
}

/// An address as Settings shows and edits it.
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AddressForm {
    id: Option<String>,
    name: String,
    organization: String,
    street: String,
    city: String,
    region: String,
    postal_code: String,
    country: String,
    phone: String,
    email: String,
}

#[tauri::command]
pub async fn browser_autofill_addresses_list(webview: Webview) -> Result<Vec<AddressForm>, String> {
    let profile = managed_profile(&webview)?;
    let mut list = addresses(&profile).await?;
    list.sort_by_key(|(_, address)| std::cmp::Reverse(address.updated_at));
    Ok(list
        .into_iter()
        .map(|(id, address)| AddressForm {
            id: Some(id),
            name: address.name,
            organization: address.organization,
            street: address.street,
            city: address.city,
            region: address.region,
            postal_code: address.postal_code,
            country: address.country,
            phone: address.phone,
            email: address.email,
        })
        .collect())
}

/// Adds an address by hand, or edits one (`id`).
#[tauri::command]
pub async fn browser_autofill_address_save(
    webview: Webview,
    address: AddressForm,
) -> Result<(), String> {
    let profile = managed_profile(&webview)?;
    let now = now_ms();
    let (id, created_at) = match address.id {
        Some(id) => {
            let (_, existing) = addresses(&profile)
                .await?
                .into_iter()
                .find(|(candidate, _)| *candidate == id)
                .ok_or("This address was removed.")?;
            (id, existing.created_at)
        }
        None => (format!("address:{}", uuid::Uuid::new_v4()), now),
    };
    let tidy = |text: String| text.split_whitespace().collect::<Vec<_>>().join(" ");
    let record = Address {
        name: tidy(address.name),
        organization: tidy(address.organization),
        street: address
            .street
            .lines()
            .map(|line| line.trim())
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        city: tidy(address.city),
        region: tidy(address.region),
        postal_code: tidy(address.postal_code),
        country: tidy(address.country),
        phone: tidy(address.phone),
        email: tidy(address.email),
        created_at,
        updated_at: now,
    };
    if record.parts().iter().all(|part| part.is_empty()) {
        return Err("Enter at least one part of the address.".into());
    }
    write_record(&profile, id, Kind::Address, &record).await
}

/// A card as Settings lists it: never its number.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardSummary {
    id: String,
    brand: &'static str,
    last4: String,
    holder: String,
    exp_month: u8,
    exp_year: u16,
}

#[tauri::command]
pub async fn browser_autofill_cards_list(webview: Webview) -> Result<Vec<CardSummary>, String> {
    let profile = managed_profile(&webview)?;
    let mut list = cards(&profile).await?;
    list.sort_by_key(|(_, card)| std::cmp::Reverse(card.updated_at));
    Ok(list
        .into_iter()
        .map(|(id, card)| CardSummary {
            id,
            brand: card_brand(&card.number),
            last4: card_last4(&card.number).to_owned(),
            holder: card.holder,
            exp_month: card.exp_month,
            exp_year: card.exp_year,
        })
        .collect())
}

/// Adds a card by hand, or edits one (`id`). An empty number keeps the saved one.
#[tauri::command]
pub async fn browser_autofill_card_save(
    webview: Webview,
    id: Option<String>,
    number: String,
    holder: String,
    exp_month: u8,
    exp_year: u16,
) -> Result<(), String> {
    let profile = managed_profile(&webview)?;
    let number = Zeroizing::new(number);
    let digits: Zeroizing<String> = Zeroizing::new(
        number
            .chars()
            .filter(|c| !matches!(c, ' ' | '-'))
            .collect::<String>(),
    );
    let now = now_ms();
    let (record_id, created_at, kept) = match id {
        Some(id) => {
            let (_, existing) = cards(&profile)
                .await?
                .into_iter()
                .find(|(candidate, _)| *candidate == id)
                .ok_or("This card was removed.")?;
            (
                id,
                existing.created_at,
                Zeroizing::new(existing.number.clone()),
            )
        }
        None => (
            format!("card:{}", uuid::Uuid::new_v4()),
            now,
            Zeroizing::new(String::new()),
        ),
    };
    let chosen: &str = if digits.is_empty() { &kept } else { &digits };
    if !card_number_valid(chosen) {
        return Err("Check the card number.".into());
    }
    if !(1..=12).contains(&exp_month) || !(2000..=2200).contains(&exp_year) {
        return Err("Check the expiry date.".into());
    }
    let mut record = Card {
        number: chosen.to_owned(),
        holder: holder.split_whitespace().collect::<Vec<_>>().join(" "),
        exp_month,
        exp_year,
        created_at,
        updated_at: now,
    };
    let result = write_record(&profile, record_id, Kind::Card, &record).await;
    record.number.zeroize();
    result
}

#[tauri::command]
pub async fn browser_autofill_delete(webview: Webview, id: String) -> Result<(), String> {
    let profile = managed_profile(&webview)?;
    profile_records(&profile)?
        .records_write(AUTOFILL, vec![(id, None)])
        .await
        .map_err(|_| "This could not be deleted. Try again.".to_owned())
}
