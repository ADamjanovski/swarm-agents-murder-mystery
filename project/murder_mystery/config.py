import yaml
from pathlib import Path
from types import SimpleNamespace

CONFIG_PATH = Path(__file__).with_name("config.yaml")
PATH_KEYS = {"stories_dir", "games_dir"}


def load_config() -> SimpleNamespace:
    """
    Load and validate the YAML config, resolving path keys and returning it as a namespace.
    """
    values = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8"))

    for key in PATH_KEYS:
        value = Path(values[key])
        if not value.is_absolute():
            value = CONFIG_PATH.parent / value
        values[key] = value

    limits = [
        value
        for key, value in values.items()
        if key != "model" and isinstance(value, (int, float))
    ]
    if any(value < 0 for value in limits) or values["max_rounds"] < 1:
        raise ValueError(
            "configuration limits must be non-negative and max_rounds at least 1"
        )

    return SimpleNamespace(**values)
