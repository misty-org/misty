#pragma once

#include <string_view>
#include <vector>
#include <cctype>

namespace misty::search {

// Fuzzy match score using a forward + backward pass to find the tightest
// (most consecutive) valid subsequence match.
//
// Forward pass: verify query is a subsequence of target; record leftmost positions.
// Backward pass: from the last matched position, scan backward to pull all
//   positions as close together as possible (maximises consecutive bonuses).
//
// Scoring per matched character:
//   +10  base per matched char
//   +15*run  consecutive run bonus (compounding: +15 for run-1, +30 for run-2, …)
//   +20  word-boundary start (pos 0, after / . _ - \ space, or camelCase transition)
//   +20  prefix bonus (first query char matches position 0 of target)
//   -2×gap  penalty per skipped character between consecutive matches
//
// Returns -1 if not a subsequence match or if score < kMinScore.
inline int fuzzy_score(std::string_view query, std::string_view target) {
    if (query.empty()) return 0;
    if (target.empty()) return -1;

    const int n = static_cast<int>(query.size());
    const int m = static_cast<int>(target.size());

    auto lc = [](char c) {
        return static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    };

    // --- Forward pass: check subsequence, record leftmost match positions ---
    std::vector<int> fwd(n);
    {
        int ti = 0;
        for (int qi = 0; qi < n; ++qi) {
            char qc = lc(query[qi]);
            while (ti < m && lc(target[ti]) != qc) ++ti;
            if (ti >= m) return -1;   // not a subsequence
            fwd[qi] = ti++;
        }
    }

    // --- Backward pass: tighten positions toward the last match ---
    // Starting from fwd[n-1], scan backward so each query character lands
    // as far right as possible without violating order — this maximises
    // consecutive runs between adjacent matched characters.
    std::vector<int> pos(n);
    {
        int ti = fwd[n - 1];
        for (int qi = n - 1; qi >= 0; --qi) {
            char qc = lc(query[qi]);
            while (lc(target[ti]) != qc) --ti;  // always terminates: fwd proved validity
            pos[qi] = ti--;
        }
    }

    // --- Score the (tightened) positions ---
    int score = 0;
    int prev  = -1;
    int run   = 0;

    for (int i = 0; i < n; ++i) {
        int p = pos[i];

        score += 10;  // base per matched char

        // Consecutive run bonus (compounding)
        if (prev >= 0 && p == prev + 1) {
            ++run;
            score += 15 * run;
        } else {
            run = 0;
            if (prev >= 0) score -= 2 * (p - prev - 1);  // gap penalty
        }

        // Word-boundary bonus
        bool at_boundary = (p == 0);
        if (!at_boundary) {
            char pc = target[p - 1];
            at_boundary = (pc == '/' || pc == '.' || pc == '_' ||
                           pc == '-' || pc == ' ' || pc == '\\');
            if (!at_boundary &&
                std::isupper(static_cast<unsigned char>(target[p])) &&
                std::islower(static_cast<unsigned char>(pc))) {
                at_boundary = true;
            }
        }
        if (at_boundary) score += 20;

        // Extra prefix bonus: first query char hits position 0 of the filename
        if (i == 0 && p == 0) score += 20;

        prev = p;
    }

    // Suppress weak / accidental subsequence matches
    constexpr int kMinScore = 20;
    return score >= kMinScore ? score : -1;
}

} // namespace misty::search
