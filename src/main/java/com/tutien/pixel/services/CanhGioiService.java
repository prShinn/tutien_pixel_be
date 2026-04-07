package com.tutien.pixel.services;

import com.tutien.pixel.entities.canhGioiEntity;
import com.tutien.pixel.repositories.CanhGioiRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;

@Service
public class CanhGioiService {

    @Autowired
    private CanhGioiRepository repo;

    public List<canhGioiEntity> all() {
        return repo.findAll();
    }

    public Optional<canhGioiEntity> get(int id) {
        return repo.findById(id);
    }

    public canhGioiEntity create(canhGioiEntity e) {
        return repo.save(e);
    }

    public canhGioiEntity update(int id, canhGioiEntity u) {
        canhGioiEntity x = repo.findById(id).orElseThrow();
        x.setCode(u.getCode());
        x.setName(u.getName());
        return repo.save(x);
    }

    public void delete(int id) {
        repo.deleteById(id);
    }
}
