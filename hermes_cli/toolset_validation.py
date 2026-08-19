"""Validation for the ``platform_toolsets`` config section.

Pure, side-effect-free helpers so the logic is unit-testable without importing
the tool registry or launching Hermes (mirrors the decoupled-helper pattern used
elsewhere in the CLI).

Motivated by #38798: a config migration silently rewrote the valid toolset name
``hermes-cli`` to the non-existent ``hermes``. ``resolve_toolset('hermes')``
returns an empty list, so every tool silently disappeared with no error, warning,
or log entry — the agent degraded to text-only replies and the cause took
significant debugging to find. Surfacing invalid toolset names (and the
zero-tools end state) loudly turns that silent failure into an actionable one.
"""

from typing import Callable, List


def validate_platform_toolsets(
    platform_toolsets: object,
    is_valid_toolset: Callable[[str], bool],
) -> List[str]:
    """Return human-readable warnings for a ``platform_toolsets`` mapping.

    Three failure modes are reported:

    1. A toolset name that ``is_valid_toolset`` rejects — usually a corrupted or
       renamed entry. When ``hermes-<platform>`` would have been valid (the exact
       #38798 shape, where ``cli`` held ``hermes`` instead of ``hermes-cli``),
       the warning includes that as a suggestion.
    2. The mapping is non-empty but resolves to *zero* valid toolsets globally,
       so the agent would start with no tools at all.
    3. A platform is configured with an *empty* toolset list. Checked
       per-platform because the global zero-valid-toolsets net in (2) is
       suppressed as soon as any other platform carries a valid toolset.

    ``is_valid_toolset`` is injected (normally :func:`toolsets.validate_toolset`)
    so this function performs no imports or I/O and is testable in isolation.

    Args:
        platform_toolsets: The raw ``platform_toolsets`` value from config. Only
            ``dict`` values carry toolset entries; anything else yields no
            warnings (nothing to validate).
        is_valid_toolset: Predicate returning ``True`` for a known toolset name.

    Returns:
        A list of warning strings (empty when everything is valid).
    """
    warnings: List[str] = []
    if not isinstance(platform_toolsets, dict) or not platform_toolsets:
        return warnings

    all_valid = 0
    for platform, raw in platform_toolsets.items():
        names = raw if isinstance(raw, list) else [raw]
        platform_valid = 0
        for name in names:
            if not isinstance(name, str) or not name:
                continue
            if is_valid_toolset(name):
                platform_valid += 1
                all_valid += 1
                continue
            suggestion = f"hermes-{platform}"
            hint = (
                f" — did you mean '{suggestion}'?"
                if is_valid_toolset(suggestion)
                else ""
            )
            warnings.append(
                f"platform '{platform}' references unknown toolset "
                f"'{name}'{hint}"
            )

        # An explicitly-empty list is honoured verbatim by platform tool
        # resolution: ``[]`` *is* a list, so the platform-default fallback is
        # skipped and the platform starts with zero configurable tools. That
        # is the intended fail-closed contract for a deliberate opt-out, but
        # it reads identically to an accidental wipe. The global ``all_valid``
        # net below cannot catch it — any *other* populated platform pushes
        # the count above zero and suppresses the safety net. Report it
        # per-platform so the zero-tools end state is never silent.
        if isinstance(raw, list) and not raw and platform_valid == 0:
            warnings.append(
                f"platform '{platform}' is configured with an empty toolset "
                f"list — the agent will have no tools on this platform. "
                f"Run `hermes tools` to reconfigure."
            )

    if all_valid == 0:
        warnings.append(
            "platform_toolsets resolves to zero valid toolsets — the agent will "
            "have no tools. Run `hermes tools` to reconfigure."
        )
    return warnings
