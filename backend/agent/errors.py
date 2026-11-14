"""Plain-language error texts for failed answers. A light module (no AI library), so the API can import it at start-up
without loading the agent stack."""

ERROR_TEXT = {
    "verification": "I couldn't produce an answer in which every number matches the data, so I'm not showing one. "
                    "Please try rephrasing or narrowing the question.",
    "format": "The model did not return a valid answer. Please try again.",
    "limit": "This question needed too many steps. Please ask about one city, pollutant or period at a time.",
    "model": "The language models are unavailable or over their free quota right now. Please try again shortly.",
    "timeout": "The AI models took too long to respond, so the answer was stopped. Please try again in a moment.",
    "other": "Something went wrong while answering. Please try again.",
}
