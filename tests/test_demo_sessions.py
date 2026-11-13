import unittest

from demo_sessions import DemoSessions


class DemoSessionTests(unittest.TestCase):
    def setUp(self):
        self.sessions = DemoSessions()
        self.session = self.sessions.create()

    def test_explicit_join_and_isolated_viewer_token(self):
        code = self.session["code"]
        self.assertEqual(len(code), 8)
        self.assertIsNone(self.sessions.join("DEADBEEF"))
        joined = self.sessions.join(code)
        self.assertEqual(joined["viewer"], self.session["viewer"])
        self.assertNotIn("controller", joined)
        self.assertIsNone(self.sessions.state(code, "wrong-token"))
        state = self.sessions.state(code, joined["viewer"])
        self.assertTrue(state["active"])
        self.assertEqual(state["seq"], 0)

    def test_only_controller_can_publish_and_stop(self):
        code = self.session["code"]
        viewer = self.session["viewer"]
        controller = self.session["controller"]
        self.assertIsNone(self.sessions.update(code, viewer, "step", 0, "library", "123"))
        self.assertIsNone(self.sessions.update(code, controller, "step", 0, "library", ""))
        self.assertIsNone(self.sessions.update(code, controller, "step", 0, "library", "x" * 200))
        self.assertIsNone(self.sessions.update(code, controller, "step", 16, "library", "123"))
        self.assertIsNone(self.sessions.update(code, controller, "step", True, "library", "123"))
        self.assertIsNone(self.sessions.update(code, controller, "step", 0, "external", "123"))
        update = self.sessions.update(code, controller, "step", 2, "spotify", "spotify:album:example")
        self.assertEqual(update["seq"], 1)
        state = self.sessions.state(code, viewer)
        self.assertEqual(state["album_id"], "spotify:album:example")
        self.assertEqual(state["source"], "spotify")
        self.assertEqual(state["step"], 2)
        self.assertIsNone(self.sessions.update(code, viewer, "stop"))
        self.sessions.update(code, controller, "stop")
        self.assertIsNone(self.sessions.state(code, viewer))
        self.assertIsNone(self.sessions.join(code))

    def test_sessions_do_not_leak_across_codes(self):
        other = self.sessions.create()
        self.assertNotEqual(other["code"], self.session["code"])
        self.assertIsNone(self.sessions.state(other["code"], self.session["viewer"]))
        self.assertIsNone(self.sessions.update(self.session["code"], other["controller"], "stop"))


if __name__ == "__main__":
    unittest.main()
