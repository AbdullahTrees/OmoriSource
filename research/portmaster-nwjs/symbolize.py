# python3 symbolize.py <breakpad .sym> <hex offset>...   -- map module offsets to function + source line
import bisect, sys
sym, wanted = sys.argv[1], sorted(int(x, 16) for x in sys.argv[2:])
files, results = {}, {}
func = None  # (start, size, name)
pending = list(wanted)
with open(sym, encoding="utf-8", errors="replace") as f:
    for line in f:
        if line.startswith("FILE "):
            _, n, path = line.rstrip("\n").split(" ", 2); files[n] = path
        elif line.startswith("FUNC "):
            parts = line.rstrip("\n").split(" ")
            if parts[1] == "m": parts.pop(1)
            func = (int(parts[1], 16), int(parts[2], 16), " ".join(parts[4:]))
            for w in wanted:
                if func[0] <= w < func[0] + func[1]: results.setdefault(w, [func[2], None])
        elif func and line[0] in "0123456789abcdef" and results:
            a, size, ln, fn = line.split()
            a, size = int(a, 16), int(size, 16)
            for w in wanted:
                if a <= w < a + size and w in results and results[w][1] is None:
                    results[w][1] = "%s:%s" % (files.get(fn, fn).split("/src/")[-1], ln)
for w in wanted:
    name, loc = results.get(w, ["?", None])
    print("0x%x  %s  %s" % (w, name[:150], loc or ""))
