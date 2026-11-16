"""Plain-language error texts for failed answers. A light module (no AI library), so the API can import it at start-up
without loading the agent stack."""

ERROR_TEXT = {
    "verification": "I couldn't check every number in this answer against the data, so I'm not showing it. "
                    "Please try again.",
    "format": "The model did not return a valid answer. Please try again.",
    "limit": "I couldn't finish this answer within my limits this time. Please try again.",
    "model": "The language models are unavailable or over their free quota right now. Please try again shortly.",
    "timeout": "The AI models took too long to respond, so the answer was stopped. Please try again in a moment.",
    "other": "Something went wrong while answering. Please try again.",
}
