"""Fit the quest recommender (`ml.md` System 2).

Implicit-feedback matrix factorisation over the `quest_interactions` view:
each account and each quest becomes a vector, and proximity between them means
"likely to be enjoyed".

**It sees no location.** The interaction matrix is (account, quest, weight) and
nothing else. `ml.md`: "The recommendation model only sees which quests were
interacted with, not where the user was." Distance is applied at serving time,
in `quest-recommendation-routes.ts`, and never enters this file.

**Nothing writes an interaction yet.** `045_quest_interactions.sql` creates the
tables `ml.md` believed already existed, and no quest is currently ever
accepted or completed — so this script finds an empty matrix and declines to
fit. That is the correct behaviour and the honest one: a handful of
interactions factorises happily and produces numbers that look like
recommendations.
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import psycopg2
import scipy.sparse as sparse
from implicit.als import AlternatingLeastSquares

# Mirrors QUEST_FLEET_INTERACTION_FLOOR in quest-recommendation.ts.
FLEET_INTERACTION_FLOOR = 500

# `ml.md`: "factors=64, iterations=20".
FACTORS = 64
ITERATIONS = 20


def load_interactions(conn):
    """(account, quest, weight) triples. Weight 0 rows are abandonments."""
    with conn.cursor() as cursor:
        cursor.execute(
            """
            SELECT account_id::text, quest_version_id::text, weight
            FROM quest_interactions
            WHERE weight > 0
            """
        )
        return cursor.fetchall()


def build_matrix(rows):
    accounts = sorted({row[0] for row in rows})
    quests = sorted({row[1] for row in rows})
    account_index = {value: index for index, value in enumerate(accounts)}
    quest_index = {value: index for index, value in enumerate(quests)}

    data = np.array([float(row[2]) for row in rows], dtype=np.float32)
    account_positions = np.array([account_index[row[0]] for row in rows])
    quest_positions = np.array([quest_index[row[1]] for row in rows])

    matrix = sparse.csr_matrix(
        (data, (account_positions, quest_positions)),
        shape=(len(accounts), len(quests)),
    )
    return matrix, accounts, quests


def main() -> int:
    parser = argparse.ArgumentParser(description="Fit the quest recommender.")
    parser.add_argument("--out", default="artifacts")
    parser.add_argument("--version", default=None)
    arguments = parser.parse_args()

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print(json.dumps({"error": "DATABASE_URL is not set"}))
        return 2

    with psycopg2.connect(database_url) as conn:
        rows = load_interactions(conn)

    if len(rows) < FLEET_INTERACTION_FLOOR:
        print(
            json.dumps(
                {
                    "fitted": False,
                    "reason": "below_floor",
                    "interactions": len(rows),
                    "floor": FLEET_INTERACTION_FLOOR,
                }
            )
        )
        return 0

    matrix, accounts, quests = build_matrix(rows)
    model = AlternatingLeastSquares(factors=FACTORS, iterations=ITERATIONS)
    model.fit(matrix)

    version = arguments.version or f"recommend_{datetime.now(timezone.utc):%Y%m%d%H%M%S}"
    out = Path(arguments.out)
    out.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {
            "model": model,
            # Account ids are stored so a served recommendation can be looked
            # up. They are the only identifying thing in the artifact, and they
            # are opaque uuids with nothing attached.
            "accounts": accounts,
            "quests": quests,
            "matrix": matrix,
            "version": version,
        },
        out / f"{version}.joblib",
    )

    print(
        json.dumps(
            {
                "fitted": True,
                "version": version,
                "trained_on_runs": len(rows),
                "metrics": {
                    "accounts": len(accounts),
                    "quests": len(quests),
                    "factors": FACTORS,
                    "iterations": ITERATIONS,
                },
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
