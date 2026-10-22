import threading
import time
from collections.abc import Callable
from typing import TypeVar


T = TypeVar("T")


class ApiUnavailableError(RuntimeError):
    """
    Raised when the provider stays unavailable past the allowed total wait.
    """
    pass


class ApiCallGuard:
    """Serialize all suspect requests and recover from temporary provider limits.

    Retries transient failures with capped exponential backoff until the cumulative wait would exceed
    ``max_total_wait_seconds``, at which point it raises ApiUnavailableError.
    """

    def __init__(
        self,
        *,
        min_interval_seconds: float,
        backoff_base_seconds: float,
        max_delay_seconds: float,
        max_total_wait_seconds: float,
        on_wait: Callable[[float, int, str], None] | None = None,
    ) -> None:
        """
        Configure the pacing interval, backoff schedule, and wait callback.
        """
        self.min_interval_seconds = min_interval_seconds
        self.backoff_base_seconds = backoff_base_seconds
        self.max_delay_seconds = max_delay_seconds
        self.max_total_wait_seconds = max_total_wait_seconds
        self.on_wait = on_wait
        self._last_started = 0.0
        self._lock = threading.Lock()

    def _pace(self) -> None:
        """
        Sleep as needed so calls are spaced at least the minimum interval apart.
        """
        with self._lock:
            delay = self.min_interval_seconds - (
                time.monotonic() - self._last_started
            )
            if delay > 0:
                time.sleep(delay)
            self._last_started = time.monotonic()

    @staticmethod
    def _chain(exc: Exception) -> list[BaseException]:
        """
        Return the exception and its cause/context chain as a list.
        """
        errors: list[BaseException] = []
        current: BaseException | None = exc
        while current is not None and current not in errors:
            errors.append(current)
            current = current.__cause__ or current.__context__
        return errors

    @classmethod
    def _is_transient(cls, exc: Exception) -> bool:
        """
        Report whether the exception chain looks like a temporary provider failure.
        """
        for error in cls._chain(exc):
            status = getattr(error, "status_code", None)
            if status == 429 or (isinstance(status, int) and status >= 500):
                return True
            message = str(error).lower()
            if any(
                marker in message
                for marker in (
                    "rate limit",
                    "throttl",
                    "too many requests",
                    "429",
                    "timeout",
                    "temporarily unavailable",
                    "service unavailable",
                )
            ):
                return True
        return False

    @classmethod
    def _detail(cls, exc: Exception) -> str:
        """
        Extract a short human-readable detail string from the exception chain.
        """
        for error in reversed(cls._chain(exc)):
            response = getattr(error, "response", None)
            text = getattr(response, "text", None)
            if text:
                return " ".join(str(text).split())[:500]
        return " ".join(str(exc).split())[:500]

    def call(self, operation: Callable[[], T]) -> T:
        """
        Run the operation with pacing and retry transient failures until success or timeout.
        """
        outage_started: float | None = None
        attempt = 0
        while True:
            self._pace()
            try:
                return operation()
            except Exception as exc:
                if not self._is_transient(exc):
                    raise
                if outage_started is None:
                    outage_started = time.monotonic()
                attempt += 1
                delay = min(
                    self.max_delay_seconds,
                    self.backoff_base_seconds * 2 ** (attempt - 1),
                )
                elapsed = time.monotonic() - outage_started
                if elapsed + delay > self.max_total_wait_seconds:
                    raise ApiUnavailableError(
                        f"provider unavailable for {elapsed:.1f} seconds"
                    ) from exc
                if self.on_wait:
                    self.on_wait(delay, attempt, self._detail(exc))
                time.sleep(delay)
