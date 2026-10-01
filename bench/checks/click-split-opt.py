# Run with cwd = click checkout. Passes when long-option prefixes split as "--".
import sys
sys.path.insert(0, "src")
from click.parser import _split_opt

assert _split_opt("--name") == ("--", "name"), _split_opt("--name")
assert _split_opt("-n") == ("-", "n"), _split_opt("-n")
assert _split_opt("name") == ("", "name"), _split_opt("name")
