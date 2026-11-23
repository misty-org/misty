use super::html_tokens::parse_nodes;

pub(crate) const DOCUMENT: usize = 0;

pub(crate) struct Element {
    pub(crate) name: String,
    pub(crate) hidden: bool,
    pub(crate) aria_hidden: bool,
    pub(crate) role: Option<String>,
}

pub(crate) enum NodeKind {
    Document,
    Text(String),
    Element(Element),
}

pub(crate) struct Node {
    pub(crate) kind: NodeKind,
    pub(crate) parent: usize,
    pub(crate) children: Vec<usize>,
    pub(crate) removed: bool,
}

pub(crate) struct Page {
    pub(crate) nodes: Vec<Node>,
}

fn is_dropped(element: &Element) -> bool {
    element.hidden
        || matches!(
            element.name.as_str(),
            "script"
                | "style"
                | "noscript"
                | "template"
                | "svg"
                | "canvas"
                | "iframe"
                | "nav"
                | "header"
                | "footer"
                | "aside"
                | "select"
        )
        || matches!(
            element.role.as_deref(),
            Some("navigation" | "banner" | "contentinfo")
        )
}

impl Page {
    pub(crate) fn parse(html: &str) -> Self {
        Self {
            nodes: parse_nodes(html),
        }
    }

    pub(crate) fn remove_dropped(&mut self) {
        for id in 1..self.nodes.len() {
            let parent = self.nodes[id].parent;
            let dropped =
                matches!(&self.nodes[id].kind, NodeKind::Element(element) if is_dropped(element));
            self.nodes[id].removed = dropped || self.nodes[parent].removed;
        }
    }

    pub(crate) fn element(&self, id: usize) -> Option<&Element> {
        match &self.nodes[id].kind {
            NodeKind::Element(element) => Some(element),
            _ => None,
        }
    }

    fn is_named(&self, id: usize, name: &str) -> bool {
        self.element(id).is_some_and(|element| element.name == name)
    }

    pub(crate) fn children(&self, id: usize) -> impl DoubleEndedIterator<Item = usize> + '_ {
        self.nodes[id]
            .children
            .iter()
            .copied()
            .filter(|child| !self.nodes[*child].removed)
    }

    fn first_element_child(&self, id: usize) -> Option<usize> {
        self.children(id)
            .find(|child| self.element(*child).is_some())
    }

    fn next_element_sibling(&self, id: usize) -> Option<usize> {
        let mut after = self
            .children(self.nodes[id].parent)
            .skip_while(|child| *child != id);
        after.next();
        after.find(|child| self.element(*child).is_some())
    }

    pub(crate) fn document_element(&self) -> Option<usize> {
        self.first_element_child(DOCUMENT)
    }

    pub(crate) fn head(&self, root: usize) -> Option<usize> {
        self.first_element_child(root)
            .filter(|first| self.is_named(*first, "head"))
    }

    pub(crate) fn body(&self, root: usize) -> Option<usize> {
        let next = match self.head(root) {
            Some(head) => self.next_element_sibling(head),
            None => self.first_element_child(root),
        };
        next.filter(|next| self.is_named(*next, "body"))
    }

    fn descendants(&self, id: usize) -> impl Iterator<Item = usize> + '_ {
        let mut stack: Vec<usize> = self.children(id).rev().collect();
        std::iter::from_fn(move || {
            let next = stack.pop()?;
            stack.extend(self.children(next).rev());
            Some(next)
        })
    }

    pub(crate) fn text_content(&self, id: usize) -> String {
        let mut text = String::new();
        for node in self.descendants(id) {
            if let NodeKind::Text(part) = &self.nodes[node].kind {
                text.push_str(part);
            }
        }
        text
    }

    pub(crate) fn title(&self, root: usize) -> String {
        let Some(head) = self.head(root) else {
            return String::new();
        };
        self.descendants(head)
            .find(|node| self.is_named(*node, "title"))
            .map_or_else(String::new, |title| self.text_content(title))
    }

    pub(crate) fn main_area(&self) -> Option<usize> {
        self.descendants(DOCUMENT).find(|node| {
            self.element(*node).is_some_and(|element| {
                matches!(element.name.as_str(), "main" | "article")
                    || element.role.as_deref() == Some("main")
            })
        })
    }
}
