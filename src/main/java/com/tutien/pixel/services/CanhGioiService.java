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

    public canhGioiEntity getById(int id) {
        return repo.findById(id)
                .orElseThrow(() -> new RuntimeException("Not found"));
    }

    public canhGioiEntity update(int id, canhGioiEntity newE) {
        canhGioiEntity e = getById(id);
        e.setCode(newE.getCode());
        e.setName(newE.getName());
        e.setDaiCanhGioi(newE.getDaiCanhGioi());
        e.setTuViTienCap(newE.getTuViTienCap());
        e.setStt(newE.getStt());
        return repo.save(e);
    }

    public void delete(int id) {
        repo.deleteById(id);
    }
}
