use crate::js_json::{text_or_empty, JsValue};
use crate::model_calls::RawJson;
use crate::model_tools::CatalogTool;
use crate::text::{js_len, js_prefix};
use crate::tool_transport::{object, string};
use crate::web_fetch::tool::{web_fetch_descriptor, WEB_FETCH_TOOL};

use super::provider::SearchProviderId;

pub(crate) const WEB_SEARCH_TOOL: &str = "web.search";

const KIND_PHRASES: [(&str, &str); 10] = [
    ("web", "web (default)"),
    ("news", "news"),
    ("videos", "videos (YouTube and others, with channel and length)"),
    ("images", "images"),
    ("places", "places (businesses with address, rating and phone)"),
    ("shopping", "shopping (products with price)"),
    ("scholar", "scholar (papers with citations)"),
    ("patents", "patents"),
    ("maps", "maps (places around a point, set near for coordinates)"),
    ("autocomplete", "autocomplete (what people commonly search for a phrase, without links; useful to find the right words)"),
];

fn phrases(provider: SearchProviderId) -> String {
    let listed: Vec<&str> = KIND_PHRASES
        .iter()
        .filter(|(kind, _)| provider.kinds().contains(kind))
        .map(|(_, phrase)| *phrase)
        .collect();
    match listed.split_last() {
        Some((last, others)) if !others.is_empty() => format!("{} or {last}", others.join(", ")),
        _ => listed.join(""),
    }
}

pub(crate) fn web_search_descriptor(id: SearchProviderId) -> CatalogTool {
    let mut kinds = id.kinds().to_vec();
    kinds.sort_unstable();
    let kinds = JsValue::Array(kinds.into_iter().map(string).collect()).stringify();
    let schema = format!(
        concat!(
            r#"{{"type":"object","required":["query"],"additionalProperties":false,"properties":{{"#,
            r#""query":{{"type":"string","minLength":1,"maxLength":400,"description":"What to find, as search keywords"}},"#,
            r#""kind":{{"type":"string","enum":{kinds},"description":"Which kind of results; web when unsure"}},"#,
            r#""domains":{{"type":"array","maxItems":10,"description":"Only search these sites, such as nih.gov or youtube.com","items":{{"type":"string","pattern":"^[A-Za-z0-9.-]+\\.[A-Za-z]{{2,}}$"}}}},"#,
            r#""recency":{{"type":"string","enum":["day","week","month","year"],"description":"Only results from this recent period"}},"#,
            r#""location":{{"type":"string","maxLength":100,"description":"Search as if from this place, such as Austin, Texas; for places, news and shopping"}},"#,
            r#""near":{{"type":"string","pattern":"^@-?\\d{{1,3}}(\\.\\d+)?,-?\\d{{1,3}}(\\.\\d+)?,\\d{{1,2}}(\\.\\d+)?z$","description":"For maps: center as @latitude,longitude,zoomz, such as @30.27,-97.74,14z"}},"#,
            r#""max_results":{{"type":"integer","minimum":1,"maximum":10}}}}}}"#,
        ),
        kinds = kinds,
    );
    CatalogTool {
        name: WEB_SEARCH_TOOL.to_owned(),
        description: format!(
            "Search the web for current or outside information: research, news, prices, documentation, or facts you are unsure of. Write the query as keywords someone would put in a title or page, not as a question to you. kind picks Google's tab: {}. Returns titles, links and short snippets; read a page with web.fetch when the snippets are not enough, and cite the links you use. Runs on this device's own search key, so it needs no app or sign-in. Use it for web research instead of search apps.",
            phrases(id),
        ),
        input_schema: RawJson::from_text(schema).unwrap_or_else(|_| RawJson::empty_object()),
        read_only: true,
        concurrent: true,
        local: true,
    }
}

pub(crate) fn with_device_tools(
    descriptors: Vec<CatalogTool>,
    device_search: Option<SearchProviderId>,
) -> Vec<CatalogTool> {
    let mut tools: Vec<CatalogTool> = device_search
        .map(web_search_descriptor)
        .into_iter()
        .collect();
    tools.push(web_fetch_descriptor());
    tools.extend(descriptors.into_iter().filter(|descriptor| {
        descriptor.name != WEB_SEARCH_TOOL && descriptor.name != WEB_FETCH_TOOL
    }));
    tools
}

const DEVICE_OUTPUT_LIMIT: usize = 64_000;

fn device_output(output: &JsValue) -> JsValue {
    let text = output.stringify();
    if js_len(&text) <= DEVICE_OUTPUT_LIMIT {
        return output.clone();
    }
    object([
        ("text", string(js_prefix(&text, DEVICE_OUTPUT_LIMIT))),
        ("truncated", JsValue::Bool(true)),
    ])
}

fn cut(value: Option<&JsValue>, limit: usize) -> JsValue {
    string(js_prefix(&text_or_empty(value), limit))
}

pub(crate) fn device_tool_activity(input: &JsValue, output: Option<&JsValue>) -> JsValue {
    let field = |name: &str| output.and_then(|output| output.get(name));
    let mut fields = if input.get("url").and_then(JsValue::as_str).is_some() {
        let read_url = field("url")
            .filter(|url| !matches!(url, JsValue::Null))
            .or(input.get("url"));
        let url = cut(read_url, 2000);
        vec![
            (
                "device_arguments".to_owned(),
                object([("url", url.clone())]),
            ),
            (
                "device_result".to_owned(),
                object([(
                    "results",
                    JsValue::Array(vec![object([
                        ("title", cut(field("title"), 200)),
                        ("url", url),
                    ])]),
                )]),
            ),
        ]
    } else {
        let query = input
            .get("query")
            .and_then(JsValue::as_str)
            .map_or_else(|| string(""), |query| string(js_prefix(query, 400)));
        let rows = field("results")
            .and_then(JsValue::as_array)
            .unwrap_or_default()
            .iter()
            .take(10)
            .map(|hit| {
                object([
                    ("title", cut(hit.get("title"), 200)),
                    ("url", cut(hit.get("url"), 2000)),
                ])
            })
            .collect();
        vec![
            ("device_arguments".to_owned(), object([("query", query)])),
            (
                "device_result".to_owned(),
                object([("results", JsValue::Array(rows))]),
            ),
        ]
    };
    if let Some(output) = output {
        fields.push(("device_output".to_owned(), device_output(output)));
    }
    JsValue::Object(fields)
}
