use std::collections::{HashMap, HashSet};

use crate::model::{Base, Item, ItemId};
use crate::names;
use crate::store::NodeRow;

#[derive(Default)]
pub struct Trees {
    pub server: HashMap<ItemId, Item>,
    pub base: HashMap<ItemId, Base>,
    pub local: HashMap<ItemId, NodeRow>,
    pub complete: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Up {
    Create(ItemId),
    Update {
        id: ItemId,
        content: bool,
        place: bool,
    },
    Trash(ItemId),
    DropLocal(ItemId),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Down {
    Add(ItemId),
    Apply {
        id: ItemId,
        content: bool,
        place: bool,
    },
    Rebase(ItemId),
    Remove(ItemId),
}

fn depth(path: &str) -> usize {
    path.matches('/').count()
}

impl Trees {
    pub fn server_live(&self, id: &ItemId) -> Option<bool> {
        let mut current = id.clone();
        for _ in 0..4096 {
            let item = self.server.get(&current)?;
            if !item.is_live() {
                return Some(false);
            }
            match &item.parent_id {
                None => return Some(true),
                Some(parent) => current = parent.clone(),
            }
        }
        None
    }

    fn server_depth(&self, id: &ItemId) -> usize {
        let mut depth = 0;
        let mut current = self.server.get(id).and_then(|item| item.parent_id.clone());
        while let Some(parent) = current {
            depth += 1;
            if depth > 4096 {
                break;
            }
            current = self
                .server
                .get(&parent)
                .and_then(|item| item.parent_id.clone());
        }
        depth
    }

    fn dirty_paths(&self) -> Vec<&str> {
        self.local
            .values()
            .filter(|node| node.dirty() && !node.trash_pending)
            .map(|node| node.path.as_str())
            .collect()
    }
}

pub fn holds_work(node: &NodeRow, dirty_paths: &[&str]) -> bool {
    dirty_paths
        .iter()
        .any(|path| names::is_within(path, &node.path))
}

fn content_differs(item: &Item, base: &Base) -> bool {
    item.sha256 != base.sha256 || item.size != base.size
}

fn place_differs(item: &Item, base: &Base) -> bool {
    item.parent_id != base.parent || item.name != base.name
}

pub fn plan_up(trees: &Trees) -> Vec<Up> {
    let trashing: Vec<&str> = trees
        .local
        .values()
        .filter(|node| node.trash_pending && !node.not_synced)
        .map(|node| node.path.as_str())
        .collect();
    let under_trash = |node: &NodeRow| {
        trashing
            .iter()
            .any(|path| *path != node.path && names::is_within(&node.path, path))
    };
    let mut creates = Vec::new();
    let mut updates = Vec::new();
    let mut trashes = Vec::new();
    let mut drops = Vec::new();
    for node in trees.local.values() {
        if node.not_synced || !node.dirty() || under_trash(node) {
            continue;
        }
        let order = (depth(&node.path), node.path.clone());
        if node.trash_pending {
            if node.created {
                drops.push((order, Up::DropLocal(node.id.clone())));
            } else {
                trashes.push((order, Up::Trash(node.id.clone())));
            }
        } else if node.created {
            creates.push((order, Up::Create(node.id.clone())));
        } else if node.dirty_content || node.dirty_place {
            updates.push((
                order,
                Up::Update {
                    id: node.id.clone(),
                    content: node.dirty_content,
                    place: node.dirty_place,
                },
            ));
        }
    }
    let mut ops = Vec::new();
    for mut group in [creates, updates, trashes, drops] {
        group.sort_by(|a, b| a.0.cmp(&b.0));
        ops.extend(group.into_iter().map(|(_, op)| op));
    }
    ops
}

pub fn plan_down(trees: &Trees) -> Vec<Down> {
    let dirty = trees.dirty_paths();
    let mut adds = Vec::new();
    let mut applies = Vec::new();
    let mut rebases = Vec::new();
    let mut removes = Vec::new();
    let mut adding: HashSet<ItemId> = HashSet::new();

    let mut ids: Vec<&ItemId> = trees.server.keys().collect();
    ids.sort_by_key(|id| (trees.server_depth(id), (*id).clone()));
    for id in ids {
        let item = &trees.server[id];
        let live = trees.server_live(id);
        match trees.local.get(id) {
            None => {
                if live != Some(true) {
                    continue;
                }
                let placeable = match &item.parent_id {
                    None => true,
                    Some(parent) => {
                        adding.contains(parent)
                            || trees
                                .local
                                .get(parent)
                                .is_some_and(|folder| !folder.trash_pending && !folder.not_synced)
                    }
                };
                if placeable {
                    adding.insert(id.clone());
                    adds.push(Down::Add(id.clone()));
                }
            }
            Some(node) if node.created => {}
            Some(node) => {
                let Some(base) = trees.base.get(id) else {
                    if live == Some(true) && !node.dirty() {
                        applies.push((
                            trees.server_depth(id),
                            Down::Apply {
                                id: id.clone(),
                                content: item.sha256 != node.sha256 || item.size != node.size,
                                place: true,
                            },
                        ));
                    }
                    continue;
                };
                if item.version == base.version {
                    continue;
                }
                if live == Some(false) {
                    if node.trash_pending || holds_work(node, &dirty) {
                        continue;
                    }
                    let parent_goes = item.parent_id.as_ref().is_some_and(|parent| {
                        trees.server_live(parent) == Some(false) && trees.local.contains_key(parent)
                    });
                    if !parent_goes {
                        removes.push(Down::Remove(id.clone()));
                    }
                    continue;
                }
                if live.is_none() {
                    continue;
                }
                let content = content_differs(item, base);
                let place = place_differs(item, base);
                if (content && node.dirty_content) || (place && node.dirty_place) {
                    continue;
                }
                if node.trash_pending {
                    continue;
                }
                if content || place {
                    applies.push((
                        trees.server_depth(id),
                        Down::Apply {
                            id: id.clone(),
                            content,
                            place,
                        },
                    ));
                } else {
                    rebases.push(Down::Rebase(id.clone()));
                }
            }
        }
    }
    if trees.complete {
        for node in trees.local.values() {
            let gone = !node.created
                && !node.not_synced
                && !trees.server.contains_key(&node.id)
                && trees.base.contains_key(&node.id);
            if gone && !holds_work(node, &dirty) {
                removes.push(Down::Remove(node.id.clone()));
            }
        }
    }
    applies.sort_by_key(|(depth, _)| *depth);
    let mut ops = adds;
    ops.extend(applies.into_iter().map(|(_, op)| op));
    ops.extend(rebases);
    ops.extend(removes);
    ops
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Kind, Seq, SpaceId, Version};

    fn item(id: &str, parent: Option<&str>, name: &str, version: i64, sha: Option<&str>) -> Item {
        Item {
            id: ItemId(id.into()),
            space_id: SpaceId("s".into()),
            parent_id: parent.map(|p| ItemId(p.into())),
            name: name.into(),
            kind: if sha.is_some() {
                Kind::File
            } else {
                Kind::Folder
            },
            sha256: sha.map(String::from),
            size: sha.map_or(0, |_| 1),
            mtime_ms: 0,
            version: Version(version),
            seq: Seq(version),
            modified_by: String::new(),
            modified_by_name: "Ana".into(),
            modified_at: String::new(),
            trashed: false,
            trashed_at: None,
            trashed_by: None,
            trash_hold: false,
            deleted: false,
            replaced_of: None,
        }
    }

    fn node_of(item: &Item, path: &str) -> NodeRow {
        NodeRow {
            ino: 1,
            space: item.space_id.clone(),
            id: item.id.clone(),
            parent: item.parent_id.clone(),
            name: item.name.clone(),
            server_name: item.name.clone(),
            kind: item.kind,
            sha256: item.sha256.clone(),
            size: item.size,
            mtime_ms: 0,
            path: path.into(),
            created: false,
            dirty_content: false,
            dirty_place: false,
            trash_pending: false,
            trash_held: false,
            trash_agent: None,
            trash_chat: None,
            not_synced: false,
            downloaded: false,
            content_base: None,
            last_used_ms: 0,
        }
    }

    fn agreed(trees: &mut Trees, item: Item, path: &str) {
        trees.base.insert(item.id.clone(), Base::of(&item));
        trees.local.insert(item.id.clone(), node_of(&item, path));
        trees.server.insert(item.id.clone(), item);
    }

    #[test]
    fn new_server_items_come_down_parents_first() {
        let mut trees = Trees::default();
        trees.server.insert(
            ItemId("b".into()),
            item("b", Some("a"), "B.txt", 1, Some("x")),
        );
        trees
            .server
            .insert(ItemId("a".into()), item("a", None, "A", 1, None));
        assert_eq!(
            plan_down(&trees),
            vec![Down::Add(ItemId("a".into())), Down::Add(ItemId("b".into()))]
        );
    }

    #[test]
    fn a_local_edit_is_never_overwritten_by_a_server_edit() {
        let mut trees = Trees::default();
        agreed(&mut trees, item("f", None, "F.txt", 1, Some("x")), "/F.txt");
        trees
            .local
            .get_mut(&ItemId("f".into()))
            .unwrap()
            .dirty_content = true;
        trees.local.get_mut(&ItemId("f".into())).unwrap().sha256 = Some("mine".into());
        trees.server.insert(
            ItemId("f".into()),
            item("f", None, "F.txt", 2, Some("theirs")),
        );
        assert!(plan_down(&trees).is_empty());
        assert_eq!(
            plan_up(&trees),
            vec![Up::Update {
                id: ItemId("f".into()),
                content: true,
                place: false
            }]
        );
    }

    #[test]
    fn a_server_delete_keeps_a_folder_holding_new_work() {
        let mut trees = Trees::default();
        agreed(&mut trees, item("d", None, "D", 1, None), "/D");
        let mut gone = item("d", None, "D", 2, None);
        gone.trashed = true;
        trees.server.insert(ItemId("d".into()), gone);
        let mut fresh = node_of(&item("n", Some("d"), "new.txt", 0, Some("y")), "/D/new.txt");
        fresh.created = true;
        trees.local.insert(ItemId("n".into()), fresh);
        assert!(plan_down(&trees).is_empty());
        assert_eq!(plan_up(&trees), vec![Up::Create(ItemId("n".into()))]);
    }

    #[test]
    fn a_server_delete_removes_what_holds_no_work() {
        let mut trees = Trees::default();
        agreed(&mut trees, item("d", None, "D", 1, None), "/D");
        agreed(
            &mut trees,
            item("f", Some("d"), "f.txt", 1, Some("x")),
            "/D/f.txt",
        );
        let mut gone = item("d", None, "D", 2, None);
        gone.trashed = true;
        trees.server.insert(ItemId("d".into()), gone);
        assert_eq!(plan_down(&trees), vec![Down::Remove(ItemId("d".into()))]);
    }

    #[test]
    fn only_the_topmost_delete_goes_up() {
        let mut trees = Trees::default();
        agreed(&mut trees, item("d", None, "D", 1, None), "/D");
        agreed(
            &mut trees,
            item("f", Some("d"), "f.txt", 1, Some("x")),
            "/D/f.txt",
        );
        for id in ["d", "f"] {
            trees
                .local
                .get_mut(&ItemId(id.into()))
                .unwrap()
                .trash_pending = true;
        }
        assert_eq!(plan_up(&trees), vec![Up::Trash(ItemId("d".into()))]);
    }

    #[test]
    fn non_overlapping_changes_both_apply() {
        let mut trees = Trees::default();
        agreed(&mut trees, item("f", None, "F.txt", 1, Some("x")), "/F.txt");
        let node = trees.local.get_mut(&ItemId("f".into())).unwrap();
        node.dirty_place = true;
        node.server_name = "G.txt".into();
        trees
            .server
            .insert(ItemId("f".into()), item("f", None, "F.txt", 2, Some("new")));
        assert_eq!(
            plan_down(&trees),
            vec![Down::Apply {
                id: ItemId("f".into()),
                content: true,
                place: false
            }]
        );
    }
}
