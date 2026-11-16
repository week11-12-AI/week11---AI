import unittest
from .server_process import ROOT
from .test_browser import main as browser_tests


def main():
    suite = unittest.defaultTestLoader.discover(str(ROOT / "tests"), pattern="test_*.py")
    if not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful():
        raise SystemExit(1)
    browser_tests()


if __name__ == "__main__":
    main()
