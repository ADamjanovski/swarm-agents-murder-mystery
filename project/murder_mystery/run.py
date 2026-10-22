import argparse
import json
from .config import load_config
from .moderator import Moderator


def build_parser() -> argparse.ArgumentParser:
    """
    Build the command-line argument parser for running a game.
    """
    parser = argparse.ArgumentParser(description="Run an autonomous murder-mystery game")
    parser.add_argument("--story", default="story_2", help="story id under stories/")
    return parser

def main() -> None:
    """
    Parse arguments, run the game, and print the result as JSON.
    """
    args = build_parser().parse_args()
    config = load_config()
    result = Moderator(config, args.story).run()
    print(
        json.dumps(
            {
                "game_id": result.game_id,
                "winner": result.winner,
                "convicted": result.convicted,
                "culprit": result.culprit,
                "record": result.record_path,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
