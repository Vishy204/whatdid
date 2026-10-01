MAX_USERS = 100

class User(Base):
    def __init__(self, name):
        self.name = name

    def display_name(self) -> str:
        return self.name

    def _private(self):
        pass


def load_users(path: str) -> list:
    return []
