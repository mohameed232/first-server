import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import httpx
import pytest

import metrics
from main import app


@pytest.fixture
def proc(tmp_path):
    (tmp_path / "stat").write_text("cpu 100 0 100 700 100 0 0 0 50 0\n")
    (tmp_path / "meminfo").write_text("MemTotal: 1000 kB\nMemAvailable: 250 kB\n")
    (tmp_path / "uptime").write_text("12345.67 10000.00\n")
    return tmp_path


def prepared_collector(proc, monkeypatch):
    collector = metrics.LinuxMetrics(proc)
    collector.previous_cpu = (900, 750)
    monkeypatch.setattr(metrics.shutil, "disk_usage", lambda path: SimpleNamespace(total=2000, used=500))
    return collector


def test_linux_aggregate_counters(proc, monkeypatch):
    collector = prepared_collector(proc, monkeypatch)
    result = asyncio.run(collector.snapshot())
    assert collector.cpu_counters() == (1000, 800)  # guest ticks not counted twice
    assert result.cpu_percent == 50
    assert result.memory.model_dump() == {"percent": 75, "used_bytes": 768000, "total_bytes": 1024000}
    assert result.disk.model_dump() == {"percent": 25, "used_bytes": 500, "total_bytes": 2000}
    assert result.uptime_seconds == 12345.67
    assert result.timestamp.tzinfo == timezone.utc


def test_first_sample_and_concurrent_requests_are_coalesced(proc, monkeypatch):
    collector = prepared_collector(proc, monkeypatch)
    collector.previous_cpu = None
    counters = iter([(1000, 800), (1100, 825)])
    monkeypatch.setattr(collector, "cpu_counters", lambda: next(counters))

    async def run():
        results = await asyncio.gather(*(collector.snapshot() for _ in range(8)))
        assert all(result is results[0] for result in results)
        assert results[0].cpu_percent == 75

    asyncio.run(run())


def test_cache_refresh_uses_new_cpu_interval(proc, monkeypatch):
    collector = prepared_collector(proc, monkeypatch)

    async def run():
        await collector.snapshot()
        collector.cached_at = -10
        (proc / "stat").write_text("cpu 175 0 100 725 100 0 0 0\n")
        result = await collector.snapshot()
        assert result.cpu_percent == 75

    asyncio.run(run())


@pytest.mark.parametrize("filename,content", [
    ("stat", "cpu 100 0 100 700 100 0 0 0\n"),  # zero delta
    ("stat", "cpu 0 0 0 0 0 0 0 0\n"),  # counter reset
    ("stat", "broken\n"),
    ("meminfo", "MemTotal: 1000 kB\n"),
    ("meminfo", "MemTotal: 1000 kB\nMemAvailable: 1001 kB\n"),
    ("meminfo", "MemTotal: 0 kB\nMemAvailable: 0 kB\n"),
    ("uptime", "nan\n"),
    ("uptime", "-1\n"),
])
def test_invalid_counters_fail_closed(proc, monkeypatch, filename, content):
    collector = prepared_collector(proc, monkeypatch)
    if filename == "stat" and content.startswith("cpu 100"):
        collector.previous_cpu = (1000, 800)
    (proc / filename).write_text(content)
    with pytest.raises((ValueError, KeyError, IndexError)):
        asyncio.run(collector.snapshot())


def test_api_contract_and_proxy_prefix_compatibility(proc, monkeypatch):
    collector = prepared_collector(proc, monkeypatch)
    monkeypatch.setattr("main.collector", collector)

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            for path in ("/api/metrics", "/metrics"):
                response = await client.get(path)
                assert response.status_code == 200
                assert response.headers["cache-control"] == "no-store"
                body = response.json()
                assert set(body) == {"cpu_percent", "memory", "disk", "uptime_seconds", "timestamp"}
                for name in ("memory", "disk"):
                    assert set(body[name]) == {"percent", "used_bytes", "total_bytes"}
                assert datetime.fromisoformat(body["timestamp"]).utcoffset().total_seconds() == 0
                assert (await client.post(path)).status_code == 405

    asyncio.run(run())


@pytest.mark.parametrize("failure", [OSError("secret path"), ValueError("host details"), KeyError("private")])
def test_api_unavailable_does_not_leak_details(monkeypatch, failure):
    async def unavailable():
        raise failure

    monkeypatch.setattr("main.collector.snapshot", unavailable)

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/metrics")
            assert response.status_code == 503
            assert response.headers["cache-control"] == "no-store"
            assert response.json() == {"detail": "Metrics temporarily unavailable"}

    asyncio.run(run())
