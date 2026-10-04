use super::*;

pub(super) fn load_page(db_path: &Path, filter: TransferFilter) -> ApiResult<TransferPage> {
    let conn = open_db(db_path)?;
    let search = filter.search.unwrap_or_default().trim().to_owned();
    let mut where_sql = transfer_search_where(&search).to_owned();
    where_sql.push_str(match filter.section.as_deref() {
        Some("active") => {
            " AND status IN ('queued', 'pending', 'in_progress', 'waiting_for_resolution') "
        }
        Some("completed") => " AND status = 'completed' ",
        Some("failed") => " AND status IN ('failed', 'interrupted') ",
        _ => "",
    });
    let total_count = count_rows(&conn, &where_sql, &search)?;
    let offset = filter.offset.unwrap_or_default().min(total_count);
    let limit = filter.limit.unwrap_or(50).clamp(1, 5_000);

    let mut sql = String::from("SELECT ");
    sql.push_str(transfer_select_columns());
    sql.push_str(" FROM transfers ");
    sql.push_str(&where_sql);
    sql.push_str(transfer_page_order_sql());
    sql.push_str(" LIMIT ? OFFSET ?");

    let rows = if search.is_empty() {
        let mut stmt = conn.prepare(&sql).map_err(sql_error)?;
        let mapped = stmt
            .query_map(params![limit as i64, offset as i64], read_record)
            .map_err(sql_error)?;
        collect_rows(mapped)?
    } else {
        let pattern = format!("%{search}%");
        let mut values = vec![pattern.as_str(); 12];
        let limit_text = limit.to_string();
        let offset_text = offset.to_string();
        values.push(limit_text.as_str());
        values.push(offset_text.as_str());
        let mut stmt = conn.prepare(&sql).map_err(sql_error)?;
        let mapped = stmt
            .query_map(rusqlite::params_from_iter(values), read_record)
            .map_err(sql_error)?;
        collect_rows(mapped)?
    };

    Ok(TransferPage {
        rows,
        total_count,
        db_path: db_path.display().to_string(),
    })
}

fn count_rows(conn: &Connection, where_sql: &str, search: &str) -> ApiResult<usize> {
    let sql = format!("SELECT COUNT(*) FROM transfers {where_sql}");
    if search.is_empty() {
        let count = conn
            .query_row(&sql, [], |row| row.get::<_, i64>(0))
            .map_err(sql_error)?;
        return Ok(count.max(0) as usize);
    }

    let pattern = format!("%{search}%");
    let values = vec![pattern.as_str(); 12];
    let count = conn
        .query_row(&sql, rusqlite::params_from_iter(values), |row| {
            row.get::<_, i64>(0)
        })
        .map_err(sql_error)?;
    Ok(count.max(0) as usize)
}
