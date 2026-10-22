import os
from strands import Agent, tool
from strands.models.openai import OpenAIModel
from strands_tools import calculator

@tool
def get_student_scores(student_name: str) -> list[float]:
    """
    Retrieve all exam scores for a given student name.
    """
    students = {
        "Andrej": [92, 88, 96, 91],
        "Elena": [78, 84, 81, 89],
        "Marko": [65, 72, 70, 68],
    }

    if student_name not in students:
        raise ValueError(f"No scores found for student: {student_name}")

    return students[student_name]

def create_agent(model_id):
    """
    Build a Strands agent on the given model with the calculator and student-scores tools.
    """
    model = OpenAIModel(
        client_args={
            "api_key": os.environ["OPENROUTER_API_KEY"],
            "base_url": "https://openrouter.ai/api/v1",
        },
        model_id=model_id,
        params={"max_tokens": 1024},
    )
    return Agent(model=model, tools=[calculator, get_student_scores])
