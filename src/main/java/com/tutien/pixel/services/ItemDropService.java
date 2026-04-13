package com.tutien.pixel.services;

import com.tutien.pixel.entities.itemDropEntity;
import com.tutien.pixel.repositories.ItemDropRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class ItemDropService {
    @Autowired
    private ItemDropRepository repo;

    public List<itemDropEntity> getAll() {
        return repo.findAll();
    }

    public itemDropEntity getById(int id) {
        return repo.findById(id).orElseThrow();
    }

    public List<itemDropEntity> getByMonsterCode(String monsterCode) {
        return repo.findByMonsterCode(monsterCode);
    }

    public itemDropEntity create(itemDropEntity e) {
        return repo.save(e);
    }

    public itemDropEntity update(int id, itemDropEntity e) {
        itemDropEntity old = repo.findById(id).orElseThrow();

        old.setItemCode(e.getItemCode());
        old.setItemName(e.getItemName());
        old.setQuestCode(e.getQuestCode());
        old.setQuestName(e.getQuestName());
        old.setMonsterCode(e.getMonsterCode());
        old.setMonsterName(e.getMonsterName());
        old.setTyLe(e.getTyLe());

        return repo.save(old);
    }

    public void deleteById(int id) {
        repo.deleteById(id);
    }

    public void deleteByMonsterCode(String monsterCode) {
        repo.deleteByMonsterCode(monsterCode);
    }
}
