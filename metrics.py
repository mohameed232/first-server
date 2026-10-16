"""Read aggregate Linux utilization; never execute commands or enumerate processes."""

import asyncio
from datetime import datetime, timezone
import math
from pathlib import Path
import shutil
import time

from pydantic import BaseModel, Field


class Capacity(BaseModel):
    percent: float = Field(ge=0, le=100, allow_inf_nan=False)
    used_bytes: int = Field(ge=0)
    total_bytes: int = Field(gt=0)


class Metrics(BaseModel):
    cpu_percent: float = Field(ge=0, le=100, allow_inf_nan=False)
    memory: Capacity
    disk: Capacity
    uptime_seconds: float = Field(ge=0, allow_inf_nan=False)
    timestamp: datetime


def capacity(used: int, total: int) -> Capacity:
    if total <= 0 or not 0 <= used <= total:
        raise ValueError("Invalid capacity counters")
    return Capacity(percent=round(100 * used / total, 1), used_bytes=used, total_bytes=total)


class LinuxMetrics:
    """Coalesce concurrent requests and cache at most one second per worker."""

    def __init__(self, proc_root: Path = Path("/proc")):
        self.proc_root = proc_root
        self.lock = asyncio.Lock()
        self.previous_cpu = None
        self.cached = None
        self.cached_at = 0.0

    def cpu_counters(self) -> tuple[int, int]:
        with (self.proc_root / "stat").open(encoding="ascii") as source:
            fields = source.readline().split()
        # Guest counters are already included in user/nice; do not count them twice.
        if not fields or fields[0] != "cpu" or len(fields) < 9:
            raise ValueError("CPU counters unavailable")
        values = [int(value) for value in fields[1:9]]
        if any(value < 0 for value in values):
            raise ValueError("Invalid CPU counters")
        return sum(values), values[3] + values[4]  # idle + iowait

    def memory(self) -> Capacity:
        fields = {}
        for line in (self.proc_root / "meminfo").read_text(encoding="ascii").splitlines():
            key, _, value = line.partition(":")
            if key in {"MemTotal", "MemAvailable"}:
                number, unit = value.split()
                if unit != "kB":
                    raise ValueError("Unexpected memory unit")
                fields[key] = int(number) * 1024
        total = fields["MemTotal"]
        return capacity(total - fields["MemAvailable"], total)

    async def snapshot(self) -> Metrics:
        async with self.lock:
            if self.cached is not None and time.monotonic() - self.cached_at < 1:
                return self.cached
            current = self.cpu_counters()
            previous = self.previous_cpu
            if previous is None:
                previous = current
                # First sample measures an interval, not utilization since boot.
                await asyncio.sleep(0.1)
                current = self.cpu_counters()
            self.previous_cpu = current
            total = current[0] - previous[0]
            idle = current[1] - previous[1]
            if total <= 0 or not 0 <= idle <= total:
                raise ValueError("CPU sample unavailable")

            memory = self.memory()
            disk = shutil.disk_usage("/")
            uptime = float((self.proc_root / "uptime").read_text(encoding="ascii").split()[0])
            if not math.isfinite(uptime) or uptime < 0:
                raise ValueError("Invalid uptime")
            self.cached = Metrics(
                cpu_percent=round(100 * (total - idle) / total, 1),
                memory=memory,
                disk=capacity(disk.used, disk.total),
                uptime_seconds=uptime,
                timestamp=datetime.now(timezone.utc),
            )
            self.cached_at = time.monotonic()
            return self.cached


collector = LinuxMetrics()
