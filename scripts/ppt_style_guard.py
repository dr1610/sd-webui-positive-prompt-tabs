"""Keep shared negatives stable when materializing styles on several prompt tabs."""
from functools import wraps
import re


def contains_style(prompt, style):
    """Match a complete style block, never remove or deduplicate individual tags."""
    text = style.strip()
    if not text:
        return True
    if "{prompt}" in text:
        if text.count("{prompt}") != 1:
            return False
        left, right = text.split("{prompt}")
        value = prompt.strip()
        return len(value) >= len(left) + len(right) and value.startswith(left) and value.endswith(right)
    # Comma/newline boundaries avoid treating 'bad hands' as present in
    # 'very bad hands' or '(bad hands:1.2)'. Preserve whitespace inside the block.
    return re.search(r"(?:^|[,\n])\s*" + re.escape(text) + r"\s*(?=$|[,\n])", prompt) is not None


def apply_negative_once(prompt, selected, database, apply):
    result = prompt
    for name in selected:
        style = database.styles.get(name)
        text = (style.negative_prompt or "") if style else ""
        if text and not contains_style(result, text):
            result = apply(result, [text])
    return result


def install():
    import gradio as gr
    from modules import shared, styles, ui_prompt_styles

    original = ui_prompt_styles.materialize_styles
    if getattr(original, "_ppt_negative_guard", False):
        return

    @wraps(original)
    def guarded(prompt, negative_prompt, selected):
        # Keep Neo's positive processing and clearing of the Styles selection.
        outputs = list(original(prompt, negative_prompt, selected))
        negative = apply_negative_once(
            negative_prompt, selected, shared.prompt_styles, styles.apply_styles_to_prompt
        )
        outputs[1] = gr.update(value=negative)
        return outputs

    guarded._ppt_negative_guard = True
    ui_prompt_styles.materialize_styles = guarded


# Registered before Gradio binds the two standard style-apply buttons.
if __name__ != "__main__":
    from modules import script_callbacks
    script_callbacks.on_before_ui(install)
