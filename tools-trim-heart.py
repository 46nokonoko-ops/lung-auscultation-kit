#!/usr/bin/env python3
"""心音の原本を、ループ再生しても段差が出ない長さに切り出す。

心周期を自己相関で推定し、拡張期（S2 の後の静かな区間）を始点・終点に選ぶ。
整数周期ぶんだけ切るので、末尾から先頭へ戻ったときに拍が途切れない。

  python3 trim.py            # sounds-raw/*.mp3 → sounds/*.m4a
"""

import math
import struct
import subprocess
import sys
import wave
from pathlib import Path

ROOT       = Path(__file__).resolve().parent
SRC_DIR    = ROOT / "sounds-raw"
OUT_DIR    = ROOT / "sounds"
TMP        = ROOT / ".trim_tmp"

TARGET_SEC = 12.0     # 目標の長さ（整数周期に丸めるので前後する）
MIN_SEC    = 8.0
MAX_SEC    = 16.0
SKIP_HEAD  = 1.5      # 冒頭の立ち上がりを避ける
FADE_MS    = 12       # 継ぎ目のクリック防止
OUT_RATE   = 44100
OUT_KBPS   = 80


def run(cmd):
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"{cmd[0]} failed: {r.stderr.decode()[:300]}")


def decode(src: Path, dst: Path, rate: int):
    run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{rate}", "-c", "1", str(src), str(dst)])


def read_wav(p: Path):
    with wave.open(str(p), "rb") as w:
        n, sr = w.getnframes(), w.getframerate()
        return list(struct.unpack(f"<{n}h", w.readframes(n))), sr


def envelope(sig, sr, hop_ms=10):
    """10ms ごとの RMS 包絡"""
    hop = max(1, int(sr * hop_ms / 1000))
    env = []
    for i in range(0, len(sig) - hop, hop):
        seg = sig[i:i + hop]
        env.append(math.sqrt(sum(s * s for s in seg) / len(seg)))
    return env, hop / sr          # 包絡, 1点あたりの秒数


def smooth(xs, k=5):
    out = []
    for i in range(len(xs)):
        lo, hi = max(0, i - k), min(len(xs), i + k + 1)
        out.append(sum(xs[lo:hi]) / (hi - lo))
    return out


def cycle_period(env, dt):
    """自己相関で心周期（秒）を推定。0.4〜1.6秒＝37〜150bpm を探索"""
    mean = sum(env) / len(env)
    x = [e - mean for e in env]
    lo, hi = int(0.4 / dt), int(1.6 / dt)
    best, best_lag = None, None
    for lag in range(lo, min(hi, len(x) - 1)):
        s = sum(x[i] * x[i + lag] for i in range(0, len(x) - lag))
        if best is None or s > best:
            best, best_lag = s, lag
    return best_lag * dt if best_lag else None


def quiet_point(env, dt, around_s, period):
    """around_s 付近の、1周期の窓のなかで最も静かな時刻（＝拡張期）"""
    half = max(2, int(period / dt / 2))
    c = int(around_s / dt)
    lo, hi = max(0, c - half), min(len(env), c + half)
    if lo >= hi:
        return around_s
    idx = min(range(lo, hi), key=lambda i: env[i])
    return idx * dt


def trim_one(src: Path):
    TMP.mkdir(exist_ok=True)
    wav = TMP / (src.stem + ".wav")
    decode(src, wav, OUT_RATE)
    sig, sr = read_wav(wav)

    env, dt = envelope(sig, sr)
    env = smooth(env)
    period = cycle_period(env, dt)
    if not period:
        period = 0.85

    start = quiet_point(env, dt, SKIP_HEAD, period)

    # 目標長に最も近い整数周期
    beats = max(1, round(TARGET_SEC / period))
    dur = beats * period
    while dur > MAX_SEC and beats > 1:
        beats -= 1
        dur = beats * period
    while dur < MIN_SEC:
        beats += 1
        dur = beats * period

    # 素材が足りなければ先頭寄りに詰める
    total = len(sig) / sr
    if start + dur > total - 0.2:
        start = max(0.0, total - dur - 0.2)
    end = quiet_point(env, dt, start + dur, period * 0.5)
    if end - start < MIN_SEC:
        end = start + dur

    a, b = int(start * sr), int(end * sr)
    cut = sig[a:b]

    # 継ぎ目のフェード
    f = int(sr * FADE_MS / 1000)
    for i in range(min(f, len(cut))):
        g = i / f
        cut[i] = int(cut[i] * g)
        cut[-1 - i] = int(cut[-1 - i] * g)

    # ピークを揃える（音源ごとの録音レベル差をならす）
    peak = max(abs(s) for s in cut) or 1
    gain = min(3.0, 0.89 * 32767 / peak)
    cut = [max(-32768, min(32767, int(s * gain))) for s in cut]

    cut_wav = TMP / (src.stem + "_cut.wav")
    with wave.open(str(cut_wav), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(struct.pack(f"<{len(cut)}h", *cut))

    OUT_DIR.mkdir(exist_ok=True)
    out = OUT_DIR / (src.stem + ".m4a")
    run(["afconvert", "-f", "m4af", "-d", "aac", "-b", str(OUT_KBPS * 1000),
         "-q", "127", str(cut_wav), str(out)])

    wav.unlink(missing_ok=True)
    cut_wav.unlink(missing_ok=True)
    return period, start, (end - start), out.stat().st_size


def main():
    files = sorted(SRC_DIR.glob("*.mp3"))
    if not files:
        sys.exit(f"音源が見つかりません: {SRC_DIR}")
    total = 0
    print(f"{'ファイル':<56}{'心周期':>7}{'開始':>7}{'長さ':>7}{'サイズ':>9}")
    for f in files:
        period, start, dur, size = trim_one(f)
        total += size
        bpm = 60 / period
        print(f"{f.stem:<56}{period:6.2f}s{start:6.1f}s{dur:6.1f}s{size/1024:8.0f}K"
              f"  ({bpm:.0f}bpm)")
    print(f"\n{len(files)} ファイル / 合計 {total/1024/1024:.1f} MB")
    if TMP.exists():
        for p in TMP.iterdir():
            p.unlink()
        TMP.rmdir()


if __name__ == "__main__":
    main()
