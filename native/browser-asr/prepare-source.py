"""Apply the small, idempotent decoding guard to the pinned private build source."""
import hashlib
import sys
from pathlib import Path

ORIGINAL_SHA256 = "891168a838301bd2baa5e8b87422a854dafeeb7da914d40a2e4c6bf33ff448ed"
INCLUDE = '#include "shengge-repeat-guard.hpp"\n'
ANCHOR = '                    // sometimes, the decoding can get stuck in a repetition loop'
GUARD = '''                    // A short recording cannot justify a stalled 64-token cycle.
                    // Fail this hypothesis, retaining the normal fallback and final pass.
                    if (n_samples <= 8*WHISPER_SAMPLE_RATE &&
                        it + 1 < (int)temperatures.size() &&
                        (result_len == 0 || seek_delta < 100*WHISPER_CHUNK_SIZE/2) &&
                        shengge_repeated_text(decoder.sequence.tokens, whisper_token_eot(ctx))) {
                        failed = true;
                        continue;
                    }
'''

def prepare(source: Path):
    target = source / 'src/whisper.cpp'
    current = target.read_text()
    # Recognize only our exact patch, then verify the original pinned input.
    original = current
    if original.startswith(INCLUDE):
        original = original[len(INCLUDE):]
        if original.count(GUARD) != 1:
            raise ValueError('Unrecognized existing decoder patch')
        original = original.replace(GUARD, '', 1)
    if hashlib.sha256(original.encode()).hexdigest() != ORIGINAL_SHA256:
        raise ValueError('Expected unmodified whisper.cpp d1be6fde or this exact guard patch')
    if original.count(ANCHOR) != 1:
        raise ValueError('Pinned decoder insertion point changed')
    patched = INCLUDE + original.replace(ANCHOR, GUARD + ANCHOR, 1)
    if patched != current:
        target.write_text(patched)
    header = Path(__file__).with_name('repetition-guard.hpp').read_bytes()
    destination = source / 'src/shengge-repeat-guard.hpp'
    if not destination.exists() or destination.read_bytes() != header:
        destination.write_bytes(header)
    print('Prepared pinned decoder with repeated-hypothesis fallback guard')

if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python3 prepare-source.py WHISPER_SOURCE')
    prepare(Path(sys.argv[1]))
