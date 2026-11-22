#include "repetition-guard.hpp"
#include <cassert>
#include <vector>
struct Token { int id; };
static auto pattern(int count, int period) {
    std::vector<Token> result;
    for (int i = 0; i < count; ++i) result.push_back({i % period + 10});
    return result;
}
int main() {
    assert(!shengge_repeated_text(std::vector<Token>{}, 100));
    assert(!shengge_repeated_text(pattern(63, 1), 100));
    for (int period = 1; period <= 4; ++period)
        assert(shengge_repeated_text(pattern(64, period), 100));
    assert(!shengge_repeated_text(pattern(64, 5), 100));
    auto words = pattern(64, 4);
    words[32].id = 42;
    assert(!shengge_repeated_text(words, 100));
    words = pattern(64, 1);
    words[32].id = 100;
    assert(!shengge_repeated_text(words, 100));
    words[32].id = -1;
    assert(!shengge_repeated_text(words, 100));
    auto prefix = pattern(64, 16), repeated = pattern(64, 2);
    prefix.insert(prefix.end(), repeated.begin(), repeated.end());
    assert(shengge_repeated_text(prefix, 100));
    assert(!shengge_repeated_text(pattern(128, 64), 100));
}
