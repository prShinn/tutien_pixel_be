package com.tutien.pixel.services;

import com.tutien.pixel.entities.npcEntity;
import com.tutien.pixel.repositories.NpcRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class NpcService {
    @Autowired
    NpcRepository repo;

    public List<npcEntity> all() {
        return repo.findAll();
    }

    public npcEntity get(int id) {
        return repo.findById(id).orElse(null);
    }

    public npcEntity getByCode(String code) {
        return repo.findByCode(code).orElse(null);
    }

    public List<npcEntity> getByMap(String mapCode) {
        return repo.findByMapCode(mapCode);
    }

    public npcEntity save(npcEntity n) {
        return repo.save(n);
    }

    public void delete(int id) {
        repo.deleteById(id);
    }
}
