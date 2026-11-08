// SPDX-License-Identifier: MIT
//! browsingData: removing website data from the browsing profile's store.
use super::{
    host::MistyExtensionHost,
    support::{once, string, truthy},
};
use block2::RcBlock;
use objc2::{rc::Retained, Message as _};

use objc2_foundation::{NSArray, NSDate, NSSet, NSString, NSURL};
use objc2_web_kit::WKWebsiteDataRecord;
use serde_json::Value;

use std::ptr::NonNull;

/// WebKit data types for each browsingData key.
fn website_data_types(types: &Value) -> Retained<NSSet<NSString>> {
    use objc2_web_kit as wk;
    let mut result: Vec<Retained<NSString>> = Vec::new();
    // SAFETY: WebKit's data type constants are immortal strings.
    unsafe {
        let map: [(&str, Vec<&NSString>); 8] = [
            ("cookies", vec![wk::WKWebsiteDataTypeCookies]),
            (
                "localStorage",
                vec![
                    wk::WKWebsiteDataTypeLocalStorage,
                    wk::WKWebsiteDataTypeSessionStorage,
                ],
            ),
            ("indexedDB", vec![wk::WKWebsiteDataTypeIndexedDBDatabases]),
            (
                "serviceWorkers",
                vec![wk::WKWebsiteDataTypeServiceWorkerRegistrations],
            ),
            (
                "cache",
                vec![
                    wk::WKWebsiteDataTypeDiskCache,
                    wk::WKWebsiteDataTypeMemoryCache,
                    wk::WKWebsiteDataTypeFetchCache,
                ],
            ),
            ("cacheStorage", vec![wk::WKWebsiteDataTypeFetchCache]),
            ("fileSystems", vec![wk::WKWebsiteDataTypeFileSystem]),
            ("webSQL", vec![wk::WKWebsiteDataTypeWebSQLDatabases]),
        ];
        for (key, names) in map {
            if truthy(types.get(key).unwrap_or(&Value::Null)) {
                result.extend(names.into_iter().map(|name| name.retain()));
            }
        }
    }
    NSSet::from_retained_slice(&result)
}

/// Whether a website data record (named by registrable domain) belongs to one of the hosts.
fn record_matches(record: &WKWebsiteDataRecord, hosts: &[Value]) -> bool {
    // SAFETY: reads the record's display name.
    let name = unsafe { record.displayName() }.to_string().to_lowercase();
    hosts.iter().filter_map(Value::as_str).any(|value| {
        let mut host = value.to_lowercase();
        if let Some(parsed) = NSURL::URLWithString(&string(&host)).and_then(|url| url.host()) {
            host = parsed.to_string().to_lowercase();
        }
        host == name || host.ends_with(&format!(".{name}"))
    })
}

impl MistyExtensionHost {
    /// Removes website data from the browsing profile's store, for every site or for named
    /// hosts. Hosts take precedence over a start time, as WebKit cannot filter by both.
    pub(super) fn remove_website_data(
        &self,
        options: &Value,
        types: &Value,
        complete: Box<dyn FnOnce()>,
    ) {
        let data_types = website_data_types(types);
        let Some(store) = self.store().filter(|_| data_types.count() > 0) else {
            return complete();
        };
        let list = |key: &str| options.get(key).and_then(Value::as_array).cloned();
        let hosts = list("hostnames").or_else(|| list("origins"));
        let excluded = list("excludeOrigins");
        let complete = once(move |()| complete());
        let done = RcBlock::new({
            let complete = complete.clone();
            move || complete(())
        });
        // SAFETY: removal on the browsing profile's own store; the handler is called once.
        unsafe {
            if hosts.is_none() && excluded.is_none() {
                let since = options
                    .get("since")
                    .and_then(Value::as_f64)
                    .map_or(0.0, |ms| ms / 1000.0);
                let date = NSDate::dateWithTimeIntervalSince1970(since);
                store.removeDataOfTypes_modifiedSince_completionHandler(&data_types, &date, &done);
                return;
            }
            let removing = store.clone();
            let types = data_types.clone();
            let fetched = RcBlock::new(move |records: NonNull<NSArray<WKWebsiteDataRecord>>| {
                let matching: Vec<Retained<WKWebsiteDataRecord>> = records
                    .as_ref()
                    .iter()
                    .filter(|record| {
                        hosts
                            .as_ref()
                            .is_none_or(|hosts| record_matches(record, hosts))
                    })
                    .filter(|record| {
                        excluded
                            .as_ref()
                            .is_none_or(|excluded| !record_matches(record, excluded))
                    })
                    .collect();
                removing.removeDataOfTypes_forDataRecords_completionHandler(
                    &types,
                    &NSArray::from_retained_slice(&matching),
                    &done,
                );
            });
            store.fetchDataRecordsOfTypes_completionHandler(&data_types, &fetched);
        }
    }
}
