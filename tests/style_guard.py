"""Run with Neo's Python; use the installed Neo style implementation."""
import importlib.util
from pathlib import Path
import runpy
import sys
import types
import unittest

neo = Path(sys.argv.pop(1))
callbacks = []
modules = types.ModuleType("modules")
modules.errors = types.SimpleNamespace(report=lambda *a, **k: None)
modules.script_callbacks = types.SimpleNamespace(on_before_ui=callbacks.append)
sys.modules["modules"] = modules
spec = importlib.util.spec_from_file_location("modules.styles", neo / "modules/styles.py")
styles = importlib.util.module_from_spec(spec)
spec.loader.exec_module(styles)
modules.styles = styles
guard = runpy.run_path(str(Path(__file__).parents[1] / "scripts/ppt_style_guard.py"))
database = types.SimpleNamespace(styles={
    "quality": styles.PromptStyle("quality", "masterpiece", "low quality, bad hands"),
    "other": styles.PromptStyle("other", "bright", "watermark"),
    "wrapper": styles.PromptStyle("wrapper", "", "avoid, {prompt}, artifacts"),
})


class GuardTests(unittest.TestCase):
    def apply(self, value, selected):
        return guard["apply_negative_once"](value, selected, database, styles.apply_styles_to_prompt)

    def test_across_three_positive_tabs(self):
        negative = "user negative"
        for _ in range(3):
            negative = self.apply(negative, ["quality"])
        self.assertEqual(negative, "user negative, low quality, bad hands")

    def test_multiple_styles_and_user_edits(self):
        value = self.apply("custom", ["quality", "other"])
        value += ", handwritten"
        self.assertEqual(self.apply(value, ["quality", "other"]), value)

    def test_partial_and_weighted_are_not_whole_matches(self):
        for value in ["low quality", "(low quality, bad hands:1.2)", "very low quality, bad hands"]:
            self.assertEqual(self.apply(value, ["quality"]), value + ", low quality, bad hands")

    def test_existing_duplicates_are_preserved(self):
        value = "low quality, bad hands, low quality, bad hands"
        self.assertEqual(self.apply(value, ["quality"]), value)

    def test_newlines_unknown_and_empty_selection(self):
        value = "custom\nlow quality, bad hands\nmore"
        self.assertEqual(self.apply(value, ["quality", "missing"]), value)
        self.assertEqual(self.apply(value, []), value)

    def test_template(self):
        value = self.apply("custom", ["wrapper"])
        self.assertEqual(self.apply(value, ["wrapper"]), value)

    def test_install_and_positive_unchanged(self):
        # Execute Neo's actual function without loading its unrelated UI imports.
        import ast
        tree = ast.parse((neo / "modules/ui_prompt_styles.py").read_text(encoding="utf-8"))
        fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "materialize_styles")
        database.apply_styles_to_prompt = lambda p, names: styles.apply_styles_to_prompt(p, [database.styles[n].prompt for n in names])
        database.apply_negative_styles_to_prompt = lambda p, names: styles.apply_styles_to_prompt(p, [database.styles[n].negative_prompt for n in names])
        modules.shared = types.SimpleNamespace(prompt_styles=database)
        gr = types.ModuleType("gradio")
        gr.update = lambda **kw: kw
        sys.modules["gradio"] = gr
        scope = {"gr": gr, "shared": modules.shared}
        exec(compile(ast.Module(body=[fn], type_ignores=[]), "neo-materialize", "exec"), scope)
        modules.ui_prompt_styles = types.SimpleNamespace(materialize_styles=scope["materialize_styles"])
        self.assertEqual(len(callbacks), 1)
        callbacks[0]()
        wrapped = modules.ui_prompt_styles.materialize_styles
        callbacks[0]()
        self.assertIs(wrapped, modules.ui_prompt_styles.materialize_styles)
        negative = ""
        for positive in ["tab A", "tab B", "tab C"]:
            result = wrapped(positive, negative, ["quality"])
            self.assertEqual(result[0]["value"], positive + ", masterpiece")
            self.assertEqual(result[1]["value"], "low quality, bad hands")
            self.assertEqual(result[2]["value"], [])
            negative = result[1]["value"]


unittest.main()
