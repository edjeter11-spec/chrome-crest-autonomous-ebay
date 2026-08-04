"""Parallel parsing + effective-parallel resolution.

These lock in the fixes for the 2026-08-04 skewed-data incident, where cheap
cards were rendering as "usually sells for $842, 100% off". Each case below is
a real production title that was parsed wrong.
"""
import pytest

from ebay_api import extract_parallel_from_title as parse
from lib.parallels import effective_parallel


class TestPrintRunAnchoring:
    """Print runs must match as whole numbers, not substrings."""

    def test_141_of_150_is_not_a_one_of_one(self):
        # "1/1" used to match inside "141/150" -> false SuperFractor (188 rows).
        title = "2025 Topps Chrome Formula 1 Blue #79 George Russell 141/150 Mercedes"
        assert parse(title) == "Blue /150"

    def test_slash_5_does_not_match_slash_50(self):
        # "/5" matched inside "46/50"; "RED BULL" supplied the colour (74 rows).
        title = "2025 Topps Chrome Sapphire F1 Liam Lawson RC Gold 46/50 RED BULL"
        assert parse(title) == "Gold /50"

    def test_slash_25_does_not_match_slash_250(self):
        title = "/250 Pink Checker Max Verstappen / Red Bull #146 2025 Topps Chrome"
        assert parse(title) == "Pink /250"

    def test_real_one_of_one_still_detected(self):
        assert parse("2025 Topps Chrome F1 Piastri SuperFractor 1/1") == "SuperFractor"

    def test_real_red_5_still_detected(self):
        assert parse("2025 Topps Chrome F1 Hamilton Red Refractor 3/5") == "Red /5"


class TestTeamNameIsNotAColour:
    def test_red_bull_alone_does_not_make_a_red_parallel(self):
        title = "2025 Topps Chrome Formula 1 #174 ORACLE RED BULL TEAM Pink Checker Flag /250"
        assert parse(title) == "Pink /250"


class TestAutographPrecedence:
    """An autograph is an autograph regardless of what else the card is."""

    def test_refractor_auto_is_an_autograph(self):
        assert parse("2025 Topps Chrome F1 Lewis Hamilton Refractor Auto") == "Autograph"

    def test_cac_code_is_an_autograph(self):
        # The #CAC- prefix is the set's autograph card-number scheme.
        assert parse("2025 Topps Chrome Formula 1 Isack Hadjar #CAC-HAD") == "Autograph"

    def test_numbered_75th_auto_stays_an_autograph(self):
        # F1 75th /75 sat above the auto check and demoted signed cards.
        title = "2025 Topps Chrome F1 Richard Verschoor AUTO F1 75 Logo Fractor 57/75"
        assert parse(title) == "Autograph"

    def test_unsigned_75th_is_still_the_numbered_parallel(self):
        title = "2025 Topps Chrome F1 Bortoleto RC F1 75 Logo Fractor Speed Wheels 57/75"
        assert parse(title) == "F1 75th /75"


class TestInsertVariants:
    def test_numeric_four_and_more(self):
        # Only the spelled-out form matched; 117 sold rows fell through to Base.
        assert parse("2025 Topps Chrome Formula 1 #4N-3 4 & More Alain Prost") == "Four & More"


class TestCompPoolLabelAlignment:
    """Labels must match what the sold-side writers store, since
    median_comp_price() compares `parallel` as an exact string."""

    def test_base_is_not_base_chrome(self):
        # "Base Chrome" found zero comps and fell back to a driver-only median.
        assert parse("2025 Topps Chrome F1 Lando Norris #12") == "Base"

    def test_superfractor_label_matches_sold_side(self):
        assert parse("2025 Topps Chrome F1 Norris SuperFractor") == "SuperFractor"


class TestEffectiveParallel:
    """The listing's own title wins over the joined card row."""

    def test_title_beats_wrong_card_row(self):
        title = "Topps 2025 Chrome Formula 1 Gabriel Bortoleto RC #92 Teal /299"
        assert effective_parallel(title, "Autograph") == "Teal /299"

    def test_card_row_used_when_title_is_unreadable(self):
        assert effective_parallel(None, "Refractor") == "Refractor"
        assert effective_parallel("", "Refractor") == "Refractor"

    def test_generic_parse_does_not_override_specific_card_row(self):
        # "Base" is the parser's fallthrough, not a positive identification.
        assert effective_parallel("2025 Topps Chrome F1 Norris", "Green /99") == "Green /99"

    def test_non_string_title_does_not_raise(self):
        assert effective_parallel(object(), "Refractor") == "Refractor"


@pytest.mark.parametrize(
    "title,expected",
    [
        ("2025 Topps Chrome F1 Hamilton Diamond 75th Anniversary #D75-4", "Diamond 75th"),
        ("2025 Topps Chrome F1 Antonelli Forest Green RayWave RC #/140", "B&W Ray Wave"),
        ("2025 Topps Chrome Formula 1 F1 Hulkenberg Neon Nations SP #NN-8", "Neon Nations"),
        ("2025 Topps Chrome Formula 1 F1 Piastri The Chain SP #CH-3", "The Chain"),
        ("2024 Topps Chrome Formula 1 Esteban Ocon [Logofractor] #9", "Logo Fractor"),
    ],
)
def test_real_production_titles(title, expected):
    assert parse(title) == expected
