#pragma once

#include <string_view>
#include <vector>
#include <cctype>

namespace misty::search {

// Fuzzy match score using Smith-Waterman-inspired greedy subsequence scoring.
// Returns -1 if query is not a subsequence of target (case-insensitive).
// Higher score = better match.
//
// Scoring bonuses per matched character:
//   +10  base score per matched char
//   +15  consecutive run (compounding per extra consecutive char)
//   +20  word-boundary start (after / . _ - space, or camelCase transition)
//   +10  prefix bonus (matched position equals query index)
//   -2x  gap penalty per skipped character in target
inline int fuzzy_score(std::string_view query, std::string_view target) {
    if (query.empty()) return 0;
    if (target.empty()) return -1;

    // Forward pass: greedily find leftmost subsequence match (case-insensitive).
    std::vector<int> match_pos;
    match_pos.reserve(query.size());

    size_t ti = 0;
    for (size_t qi = 0; qi < query.size(); ++qi) {
        char qc = static_cast<char>(std::tolower(static_cast<unsigned char>(query[qi])));
        bool found = false;
        while (ti < target.size()) {
            char tc = static_cast<char>(std::tolower(static_cast<unsigned char>(target[ti])));
            ++ti;
            if (tc == qc) {
                match_pos.push_back(static_cast<int>(ti) - 1);
                found = true;
                break;
            }
        }
        if (!found) return -1;
    }

    // Score the match positions.
    int score = 0;
    int prev = -1;
    int consecutive = 0;

    for (size_t i = 0; i < match_pos.size(); ++i) {
        int pos = match_pos[i];

        // Base score
        score += 10;

        // Consecutive bonus (compounding)
        if (prev != -1 && pos == prev + 1) {
            ++consecutive;
            score += 15 * consecutive;
        } else {
            consecutive = 0;
            // Gap penalty
            if (prev != -1) {
                score -= 2 * (pos - prev - 1);
            }
        }

        // Word-boundary bonus
        bool at_boundary = (pos == 0);
        if (!at_boundary && pos > 0) {
            char p = target[pos - 1];
            at_boundary = (p == '/' || p == '.' || p == '_' ||
                           p == '-' || p == ' ' || p == '\\');
            // camelCase: current is uppercase, previous is lowercase
            if (!at_boundary &&
                std::isupper(static_cast<unsigned char>(target[pos])) &&
                std::islower(static_cast<unsigned char>(p))) {
                at_boundary = true;
            }
        }
        if (at_boundary) score += 20;

        // Prefix bonus: matched position lines up with query index
        if (pos == static_cast<int>(i)) score += 10;

        prev = pos;
    }

    return std::max(0, score);
}

} // namespace misty::search
