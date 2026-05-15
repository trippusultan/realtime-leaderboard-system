# Realtime Leaderboard System

Node.js + Express API backed by **Redis sorted sets** for persistent, O(log N) rank queries and instant score updates.

---

## Architecture

| Layer        | Tech                   |
|--------------|------------------------|
| Auth         | bcrypt + JWT           |
| Storage      | Redis (sorted sets)    |
| API          | Express / Express Validator |
| Container    | Docker / Docker Compose |

### Redis Key Layout

```
user:{id}              HASH   — name, email, password_hash, created_at
user:email:{email}     STR    → userId  (auxiliary index)
game:{name}:lb         ZSET   — score → userId
global:lb              ZSET   — globalScore → userId
score:h:{uid}:{game}   ZSET   — timestamp_ms → timestamp_ms  (history pointer)
score:snap:{uid}:{game}:{ts}ms HASH — {score, timestamp_ms}
game:list              SET    — all known game names
```

---

## Quick Start

```bash
cd /home/spoidy/workspace/leaderboard

# 1. copy env
cp .env.example .env

# 2. start redis + api
docker compose up
```

### Local (without Docker)

```bash
# redis must be running on 127.0.0.1:5000
redis-server &
npm install
cp .env.example .env
npm start
```

---

## API Reference

Base URL: `http://localhost:5000/api`

### `POST /auth/register`
```json
{ "name": "Alice", "email": "alice@example.com", "password": "secret123" }
```
→ `{ token, user: { id, name, email } }`

### `POST /auth/login`
```json
{ "email": "alice@example.com", "password": "secret123" }
```
→ `{ token, user: { id, name, email } }`

### `POST /scores`  _(auth required — `Authorization: Bearer <token>`)_
```json
{ "game": "chess", "score": 2500 }
```
→ `{ game, score, timestamp_ms, rank: 3 }`

### `GET /leaderboard?game=chess&count=10&withUser=1`
→ `{ board: "chess", count: 10, entries: [{ userId, score, name? }, ...] }`

### `GET /leaderboard/rank?game=chess`  _(auth required)_
→ `{ rank: 7, userId: "abc", name: "Alice" }`

### `GET /leaderboard/around?game=chess&offset=5`  _(auth required)_
→ `{ centreUserId, centreRank, windowSize, entries: [...] }`

### `GET /leaderboard/games`
→ `[{ name: "chess" }, { name: "poker" }, ...]`

### `GET /scores/history?game=chess`  _(auth required)_
→ `[{ game: "chess", timestamp_ms, score }, ...]`

### `GET /leaderboard/top-players?count=10&period=all|daily|weekly|monthly`
→ `{ period, totalPlayers, global: [...], perGame: { "chess": [...] } }`

---

## Performance Notes

| Operation | Redis command | Complexity |
|-----------|---------------|------------|
| Submit score | `ZADD` + `ZADD` + `ZADD` | O(log N) |
| Top-N global | `ZREVRANGE 0 N-1` | O(log N + N) |
| Top-N per-game | `ZREVRANGE` on game key | O(log N + N) |
| User rank | `ZREVRANK` | O(log N) |
| Around-user | `ZREVRANK` + `ZREVRANGE` | O(log N + N) |
| Score history | `ZREVRANGE` on user-history key | O(log N + N) |

All paths stay **sub-millisecond** up to millions of players.

---

## License

MIT
