package com.tutien.pixel.services;

import com.tutien.pixel.entities.monsterEntity;
import com.tutien.pixel.repositories.MonsterRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class MonsterService {
    @Autowired
    MonsterRepository repo;

    public List<monsterEntity> all() {
        return repo.findAll();
    }

    public monsterEntity get(int id) {
        return repo.findById(id).orElse(null);
    }

    public monsterEntity getByCode(String code) {
        return repo.findByCode(code).orElse(null);
    }

    public monsterEntity save(monsterEntity m) {
        return repo.save(m);
    }

    public void delete(int id) {
        repo.deleteById(id);
    }
}