package store

type Store struct {
	items map[string]string
}

func New() *Store { return &Store{} }

func (s *Store) Get(key string) (string, bool) {
	v, ok := s.items[key]
	return v, ok
}

func helper() {}
