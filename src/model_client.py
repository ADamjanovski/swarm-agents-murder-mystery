import litellm
import time
import random
from .config import RETRYABLE
from litellm import completion, APIError

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

litellm.suppress_debug_info = True
litellm.set_verbose = False

def get_client(provider, model, max_retries=4, base_delay=1.0, max_delay=30.0, **kwargs):
    """
    Build a LiteLLM completion client with exponential-backoff retries on transient errors.
    """
    def client(prompt, **call_kwargs):
        """
        Send one prompt to the model and return the reply text, retrying transient failures.
        """
        merged_kwargs = {**kwargs, **call_kwargs}
        if provider == "openrouter":
            merged_kwargs["base_url"] = OPENROUTER_BASE_URL

        last_exc = None
        for attempt in range(max_retries + 1):   
            try:
                response = completion(
                    model=f"{provider}/{model}",
                    messages=[{"role": "user", "content": prompt}],
                    **merged_kwargs,
                )
                return response.choices[0].message.content

            except RETRYABLE as e:
                last_exc = e
                if attempt == max_retries:
                    break                          

                delay = min(base_delay * (2 ** attempt), max_delay)
                delay = delay * (0.5 + random.random())  
                print(f"[retry {attempt + 1}/{max_retries}] {type(e).__name__}: {e}. "
                      f"waiting {delay:.1f}s")
                time.sleep(delay)

            except APIError as e:
                raise

        raise last_exc  

    return client