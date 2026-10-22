from pathlib import Path
from litellm import RateLimitError, APIConnectionError, Timeout, InternalServerError

BASE_DIR = Path(__file__).resolve().parent          
DATA_DIR = BASE_DIR / "context_data"

URL_FILES =[
    "https://magazine.sebastianraschka.com/p/practical-tips-for-finetuning-llms",
    "https://sebastianraschka.com/blog/2023/llm-finetuning-lora.html",
    "https://magazine.sebastianraschka.com/p/lora-and-dora-from-scratch"
]

PDF_FILES = [
    DATA_DIR / "lora.pdf",
    DATA_DIR / "qlora.pdf",
]

RETRYABLE = (RateLimitError, Timeout, APIConnectionError, InternalServerError)

EVALUATION_QUESTIONS = [
    "What LoRA rank r did the original LoRA paper use for its main GLUE experiments?",
    "How much GPU memory does QLoRA save according to Raschka's experiments?",
    "What is the common rule of thumb for setting LoRA alpha relative to rank?",
    "What 4-bit data type does QLoRA introduce?",
    "What runtime increase does QLoRA cost versus regular LoRA?",
]