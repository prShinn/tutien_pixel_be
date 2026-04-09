package com.tutien.pixel.services;

import com.tutien.pixel.entities.spawnMonsterEntity;
import com.tutien.pixel.repositories.SpawnMonsterRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class SpawnMonsterService {
    @Autowired
    SpawnMonsterRepository repo;

    public List<spawnMonsterEntity> all() {
        return repo.findAll();
    }

    public spawnMonsterEntity get(int id) {
        return repo.findById(id).orElse(null);
    }

    public List<spawnMonsterEntity> getByMap(String mapCode) {
        return repo.findByMapCode(mapCode);
    }

    public spawnMonsterEntity save(spawnMonsterEntity e) {
        return repo.save(e);
    }

    public void delete(int id) {
        repo.deleteById(id);
    }
}