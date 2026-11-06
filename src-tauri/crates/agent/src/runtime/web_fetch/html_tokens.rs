//! Parses a fetched page into the tree `html_tree.rs` reads.
//!
//! The text the agent reads was tuned on linkedom, which builds its tree with htmlparser2. That tree
//! isn't the one an HTML5 tree builder makes: no `html`, `head` or `body` is implied, nothing is moved
//! out of a table, and a tag closes only what htmlparser2's small table says it closes. What a page
//! reads as depends on those choices (a page with no `body` tag reads as empty), so html5ever's
//! tree builder would change results. This uses its tokenizer and repeats htmlparser2's `Parser.js`
//! over the tokens, which keeps the same tree with a maintained parser underneath.
use std::{cell::RefCell, collections::HashMap};

use html5ever::{
    tendril::StrTendril,
    tokenizer::{states::RawKind, BufferQueue, Tag, TagKind, Token, TokenSink, TokenSinkResult, Tokenizer, TokenizerOpts},
    TokenizerResult,
};

use super::html_tree::{Element, Node, NodeKind, DOCUMENT};

const FORM_TAGS: &[&str] = &["input", "option", "optgroup", "select", "button", "datalist", "textarea"];

/// What opening a tag closes, while it's on top of the stack (`openImpliesClose`).
fn implied_closes(name: &str) -> &'static [&'static str] {
    match name {
        "tr" => &["tr", "th", "td"],
        "th" => &["th"],
        "td" => &["thead", "th", "td"],
        "body" => &["head", "link", "script"],
        "li" => &["li"],
        "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "address" | "article" | "aside" | "blockquote" | "details" | "div" | "dl" | "fieldset" | "figcaption" | "figure" | "footer"
        | "form" | "header" | "hr" | "main" | "nav" | "ol" | "pre" | "section" | "table" | "ul" => &["p"],
        "select" | "input" | "output" | "button" | "datalist" | "textarea" => FORM_TAGS,
        "option" => &["option"],
        "optgroup" => &["optgroup", "option"],
        "dd" | "dt" => &["dd", "dt"],
        "rt" | "rp" => &["rt", "rp"],
        "tbody" | "tfoot" => &["thead", "tbody"],
        _ => &[],
    }
}

fn is_void(name: &str) -> bool {
    matches!(
        name,
        "area" | "base" | "basefont" | "br" | "col" | "command" | "embed" | "frame" | "hr" | "img" | "input" | "isindex" | "keygen" | "link" | "meta" | "param" | "source" | "track" | "wbr"
    )
}

fn is_foreign(name: &str) -> bool {
    matches!(name, "math" | "svg")
}

fn is_html_integration(name: &str) -> bool {
    matches!(name, "mi" | "mo" | "mn" | "ms" | "mtext" | "annotation-xml" | "foreignobject" | "desc" | "title")
}

/// The tags whose text htmlparser2's tokenizer doesn't look inside. It decodes entities in `title`
/// alone, and `script` ends at the first `</script`, with none of the HTML5 escape states.
fn raw_kind(name: &str) -> Option<RawKind> {
    match name {
        "title" => Some(RawKind::Rcdata),
        "script" | "style" | "textarea" | "xmp" => Some(RawKind::Rawtext),
        _ => None,
    }
}

struct Builder {
    nodes: Vec<Node>,
    current: usize,
    // Open tag names, innermost last.
    stack: Vec<String>,
    // How many of each name are open. Without it, a page of close tags that match nothing would
    // search a deep stack once each, which a hostile page can make take minutes.
    open: HashMap<String, usize>,
    // Innermost last, starting at false as in HTML mode.
    foreign: Vec<bool>,
}

impl Builder {
    fn push_node(&mut self, kind: NodeKind) -> usize {
        let id = self.nodes.len();
        self.nodes.push(Node { kind, parent: self.current, children: Vec::new(), removed: false });
        self.nodes[self.current].children.push(id);
        id
    }

    fn text(&mut self, text: &str) {
        if let Some(&last) = self.nodes[self.current].children.last() {
            if let NodeKind::Text(existing) = &mut self.nodes[last].kind {
                existing.push_str(text);
                return;
            }
        }
        self.push_node(NodeKind::Text(text.to_owned()));
    }

    fn close_node(&mut self) {
        self.current = self.nodes[self.current].parent;
    }

    fn push_open(&mut self, name: &str) {
        self.stack.push(name.to_owned());
        *self.open.entry(name.to_owned()).or_insert(0) += 1;
    }

    /// Closes the innermost open tag.
    fn pop_open(&mut self) {
        if let Some(name) = self.stack.pop() {
            if let Some(count) = self.open.get_mut(&name) {
                *count -= 1;
            }
            self.close_node();
        }
    }

    fn open_element(&mut self, tag: &Tag) {
        let mut element = Element { name: tag.name.to_string(), hidden: false, aria_hidden: false, role: None };
        for attribute in &tag.attrs {
            match &*attribute.name.local {
                "hidden" => element.hidden = true,
                "aria-hidden" => element.aria_hidden = &*attribute.value == "true",
                "role" => element.role = Some(attribute.value.to_string()),
                _ => {}
            }
        }
        self.current = self.push_node(NodeKind::Element(element));
    }

    /// `emitOpenTag`.
    fn emit_open_tag(&mut self, name: &str) {
        let closes = implied_closes(name);
        while self.stack.last().is_some_and(|open| closes.contains(&open.as_str())) {
            self.pop_open();
        }
        if !is_void(name) {
            self.push_open(name);
            if is_foreign(name) {
                self.foreign.push(true);
            } else if is_html_integration(name) {
                self.foreign.push(false);
            }
        }
    }

    fn start_tag(&mut self, tag: &Tag) -> TokenSinkResult<()> {
        let name: &str = &tag.name;
        self.emit_open_tag(name);
        self.open_element(tag);
        // `endOpenTag`.
        if is_void(name) {
            self.close_node();
        }
        if tag.self_closing {
            // Only foreign content has self-closing tags, and a special tag that closes itself has no text.
            if self.foreign.last() == Some(&true) && self.stack.last().is_some_and(|open| open == name) {
                self.pop_open();
            }
            return TokenSinkResult::Continue;
        }
        raw_kind(name).map_or(TokenSinkResult::Continue, TokenSinkResult::RawData)
    }

    /// `onclosetag`.
    fn end_tag(&mut self, name: &str) {
        if is_foreign(name) || is_html_integration(name) {
            self.foreign.pop();
        }
        if !is_void(name) {
            if self.open.get(name).is_some_and(|count| *count > 0) {
                while self.stack.last().is_some_and(|open| open != name) {
                    self.pop_open();
                }
                self.pop_open();
            } else if name == "p" {
                self.empty_element(name);
            }
        } else if name == "br" {
            self.empty_element(name);
        }
    }

    /// A close tag with nothing to close stands for an empty element.
    fn empty_element(&mut self, name: &str) {
        if name == "p" {
            self.emit_open_tag(name);
            if let Some(count) = self.open.get_mut(name) {
                *count -= 1;
            }
            self.stack.pop();
        }
        let tag = Tag { kind: TagKind::StartTag, name: name.into(), self_closing: false, attrs: Vec::new() };
        self.open_element(&tag);
        self.close_node();
    }
}

struct Sink(RefCell<Builder>);

impl TokenSink for Sink {
    type Handle = ();

    fn process_token(&self, token: Token, _line_number: u64) -> TokenSinkResult<()> {
        let mut builder = self.0.borrow_mut();
        match token {
            Token::TagToken(tag) => match tag.kind {
                TagKind::StartTag => return builder.start_tag(&tag),
                TagKind::EndTag => builder.end_tag(&tag.name),
            },
            Token::CharacterTokens(text) => builder.text(&text),
            Token::NullCharacterToken => builder.text("\0"),
            Token::DoctypeToken(_) | Token::CommentToken(_) | Token::EOFToken | Token::ParseError(_) => {}
        }
        TokenSinkResult::Continue
    }
}

pub(super) fn parse_nodes(html: &str) -> Vec<Node> {
    let root = Node { kind: NodeKind::Document, parent: DOCUMENT, children: Vec::new(), removed: false };
    let builder = Builder { nodes: vec![root], current: DOCUMENT, stack: Vec::new(), open: HashMap::new(), foreign: vec![false] };
    // The body keeps its byte order mark, as Node's decoding did.
    let options = TokenizerOpts { discard_bom: false, ..TokenizerOpts::default() };
    let tokenizer = Tokenizer::new(Sink(RefCell::new(builder)), options);
    let queue = BufferQueue::default();
    // A fetched body is at most 2 MiB, far under what a tendril can hold.
    queue.push_back(StrTendril::from_slice(html));
    // The sink never asks to pause for a script, so one call takes the whole input.
    while matches!(tokenizer.feed(&queue), TokenizerResult::Script(())) {}
    tokenizer.end();
    tokenizer.sink.0.into_inner().nodes
}
