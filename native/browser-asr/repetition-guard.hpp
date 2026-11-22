#pragma once
#include <cstddef>

// Reject a stalled hypothesis, never mark its partial text as completed.
// Timestamp/special tokens break repetition. This is not a token limit.
template<class Tokens>
static bool shengge_repeated_text(const Tokens &tokens, int text_end) {
    constexpr std::size_t window = 64;
    if (tokens.size() < window) return false;
    const auto start = tokens.size() - window;
    for (auto i = start; i < tokens.size(); ++i)
        if (tokens[i].id < 0 || tokens[i].id >= text_end) return false;
    for (std::size_t period = 1; period <= 4; ++period) {
        bool repeated = true;
        for (auto i = start + period; i < tokens.size(); ++i)
            if (tokens[i].id != tokens[i - period].id) { repeated = false; break; }
        if (repeated) return true;
    }
    return false;
}
